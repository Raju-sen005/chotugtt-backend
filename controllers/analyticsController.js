const mongoose = require("mongoose");
const Order = require("../models/Order");

const IST_TIMEZONE = "Asia/Kolkata";

const EMPTY_REVENUE = {
  today: 0,
  totalRevenue: 0,
  totalOrders: 0,
};

exports.getDashboardStats = async (req, res) => {
  try {
    // --------------------------------------------------
    // TENANT VALIDATION
    // --------------------------------------------------

    const restaurantId = req.user?.restaurantId;

    if (
      !restaurantId ||
      !mongoose.Types.ObjectId.isValid(restaurantId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid restaurant context",
      });
    }

    const rId = new mongoose.Types.ObjectId(restaurantId);

    // --------------------------------------------------
    // DATE RANGE
    // --------------------------------------------------

    const now = new Date();

    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    // --------------------------------------------------
    // BASE MATCH
    // --------------------------------------------------

    const baseMatch = {
      restaurantId: rId,
      status: "COMPLETED",
    };

    // --------------------------------------------------
    // SINGLE MONGODB AGGREGATION
    // --------------------------------------------------

    const [result] = await Order.aggregate([
      {
        $match: baseMatch,
      },

      {
        $facet: {
          // --------------------------------------------
          // REVENUE + TOTAL ORDERS
          // --------------------------------------------

          revenueStats: [
            {
              $group: {
                _id: null,

                totalRevenue: {
                  $sum: "$total",
                },

                totalOrders: {
                  $sum: 1,
                },

                today: {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          {
                            $dateToString: {
                              format: "%Y-%m-%d",
                              date: "$createdAt",
                              timezone: IST_TIMEZONE,
                            },
                          },
                          {
                            $dateToString: {
                              format: "%Y-%m-%d",
                              date: now,
                              timezone: IST_TIMEZONE,
                            },
                          },
                        ],
                      },
                      "$total",
                      0,
                    ],
                  },
                },
              },
            },
          ],

          // --------------------------------------------
          // TOP SELLING ITEMS
          // --------------------------------------------

          topItems: [
            {
              $unwind: "$items",
            },

            {
              $match: {
                "items.status": "ACTIVE",
              },
            },

            {
              $group: {
                _id: "$items.name",

                count: {
                  $sum: "$items.quantity",
                },
              },
            },

            {
              $sort: {
                count: -1,
                _id: 1,
              },
            },

            {
              $limit: 5,
            },
          ],

          // --------------------------------------------
          // WEEKLY TREND
          // --------------------------------------------

          weeklyTrend: [
            {
              $match: {
                createdAt: {
                  $gte: sevenDaysAgo,
                },
              },
            },

            {
              $group: {
                _id: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$createdAt",
                    timezone: IST_TIMEZONE,
                  },
                },

                sales: {
                  $sum: "$total",
                },
              },
            },

            {
              $sort: {
                _id: 1,
              },
            },
          ],

          // --------------------------------------------
          // TABLE STATS
          // --------------------------------------------

          tableStats: [
            {
              $group: {
                _id: "$tableNumber",

                orderCount: {
                  $sum: 1,
                },
              },
            },

            {
              $sort: {
                orderCount: -1,
                _id: 1,
              },
            },
          ],

          // --------------------------------------------
          // HOURLY STATS — IST
          // --------------------------------------------

          hourlyStats: [
            {
              $project: {
                hour: {
                  $hour: {
                    date: "$createdAt",
                    timezone: IST_TIMEZONE,
                  },
                },
              },
            },

            {
              $group: {
                _id: "$hour",

                count: {
                  $sum: 1,
                },
              },
            },

            {
              $sort: {
                _id: 1,
              },
            },
          ],
        },
      },
    ]);

    // --------------------------------------------------
    // NORMALIZE RESPONSE
    // --------------------------------------------------

    const revenueStats =
      result?.revenueStats?.[0] || EMPTY_REVENUE;

    const topItems =
      result?.topItems || [];

    const tableStats =
      result?.tableStats || [];

    const hourlyStats =
      result?.hourlyStats || [];

    // --------------------------------------------------
    // GUARANTEE LAST 7 DAYS
    // --------------------------------------------------

    const weeklyMap = new Map(
      (result?.weeklyTrend || []).map(
        (item) => [item._id, item.sales]
      )
    );

    const weeklyTrend = [];

    for (let i = 0; i < 7; i += 1) {
      const date = new Date(sevenDaysAgo);

      date.setDate(
        sevenDaysAgo.getDate() + i
      );

      const day = date.toLocaleDateString(
        "en-CA",
        {
          timeZone: IST_TIMEZONE,
        }
      );

      weeklyTrend.push({
        day,
        sales: weeklyMap.get(day) || 0,
      });
    }

    // --------------------------------------------------
    // RESPONSE
    // --------------------------------------------------

    return res.status(200).json({
      success: true,

      data: {
        revenueStats: {
          today:
            Number(revenueStats.today) || 0,

          totalRevenue:
            Number(revenueStats.totalRevenue) || 0,

          totalOrders:
            Number(revenueStats.totalOrders) || 0,
        },

        tableStats,

        topItems,

        weeklyTrend,

        hourlyStats,
      },
    });
  } catch (error) {
    console.error(
      "❌ Dashboard analytics error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Unable to load analytics data",
    });
  }
};