const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

let io;

/*
 * --------------------------------------------------
 * HELPERS
 * --------------------------------------------------
 */

const getRestaurantId = (user) => {
  if (!user?.restaurantId) {
    return null;
  }

  if (
    typeof user.restaurantId === "object" &&
    user.restaurantId._id
  ) {
    return String(user.restaurantId._id);
  }

  return String(user.restaurantId);
};

const restaurantRoom = (restaurantId) =>
  `restaurant:${String(restaurantId)}`;

const orderRoom = (orderId) =>
  `order:${String(orderId)}`;

/*
 * --------------------------------------------------
 * SOCKET AUTHENTICATION
 * --------------------------------------------------
 *
 * JWT cookie is used.
 *
 * Socket.IO handshake receives the same HTTP-only
 * cookie because frontend uses:
 *
 * withCredentials: true
 */
const authenticateSocket = async (socket, next) => {
  try {
    const cookieHeader =
      socket.handshake.headers?.cookie || "";

    if (!cookieHeader) {
      return next(
        new Error("Authentication required")
      );
    }

    /*
     * Extract jwt cookie
     */
    const cookies = cookieHeader
      .split(";")
      .reduce((acc, cookie) => {
        const index = cookie.indexOf("=");

        if (index === -1) {
          return acc;
        }

        const key = cookie
          .slice(0, index)
          .trim();

        const value = cookie
          .slice(index + 1)
          .trim();

        acc[key] = decodeURIComponent(value);

        return acc;
      }, {});

    const token = cookies.jwt;

    if (!token) {
      return next(
        new Error("Authentication required")
      );
    }

    /*
     * Verify JWT
     */
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    if (!decoded?.id) {
      return next(
        new Error("Invalid authentication token")
      );
    }

    /*
     * Load current user from DB.
     *
     * This is important because restaurant membership
     * should come from server-side data, not client data.
     */
    const user = await User.findById(decoded.id)
      .select(
        "_id email name restaurantId role isActive"
      )
      .lean();

    if (!user) {
      return next(
        new Error("User not found")
      );
    }

    /*
     * Optional account protection.
     */
    if (
      user.isActive !== undefined &&
      user.isActive === false
    ) {
      return next(
        new Error("Account is inactive")
      );
    }

    const restaurantId =
      getRestaurantId(user);

    if (!restaurantId) {
      return next(
        new Error(
          "Restaurant access is not configured"
        )
      );
    }

    /*
     * Attach authenticated identity to socket.
     */
    socket.user = {
      _id: String(user._id),
      email: user.email,
      name: user.name,
      role: user.role,
      restaurantId,
    };

    next();
  } catch (error) {
    console.error(
      "❌ Socket authentication failed:",
      error.message
    );

    next(
      new Error("Authentication failed")
    );
  }
};

/*
 * --------------------------------------------------
 * INITIALIZE SOCKET.IO
 * --------------------------------------------------
 */

const initSocket = (server) => {
  if (io) {
    return io;
  }

  const allowedOrigins = (
    process.env.FRONTEND_URLS ||
    process.env.FRONTEND_URL ||
    "http://localhost:5173"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        /*
         * Allow server-to-server / non-browser requests.
         */
        if (!origin) {
          return callback(null, true);
        }

        if (
          allowedOrigins.includes(origin)
        ) {
          return callback(null, true);
        }

        console.warn(
          "🚫 Socket CORS rejected:",
          origin
        );

        return callback(
          new Error("Not allowed by Socket.IO CORS")
        );
      },

      credentials: true,
    },

    /*
     * WebSocket preferred, polling fallback.
     */
    transports: [
      "websocket",
      "polling",
    ],

    /*
     * Network stability.
     */
    pingInterval: 25000,
    pingTimeout: 60000,

    /*
     * Recover short network interruptions.
     */
    connectionStateRecovery: {
      maxDisconnectionDuration:
        2 * 60 * 1000,

      skipMiddlewares: false,
    },

    /*
     * Protect against oversized packets.
     */
    maxHttpBufferSize: 1e6,
  });

  /*
   * --------------------------------------------------
   * AUTH MIDDLEWARE
   * --------------------------------------------------
   */
  io.use(authenticateSocket);

  /*
   * --------------------------------------------------
   * CONNECTION
   * --------------------------------------------------
   */
  io.on("connection", (socket) => {
    const restaurantId =
      socket.user.restaurantId;

    const restaurantRoomName =
      restaurantRoom(restaurantId);

    /*
     * ------------------------------------------------
     * AUTOMATIC TENANT ROOM JOIN
     * ------------------------------------------------
     *
     * Client does NOT send restaurantId.
     */
    socket.join(restaurantRoomName);

    console.log(
      `🟢 Socket connected | ${socket.id} | restaurant=${restaurantId} | user=${socket.user._id}`
    );

    console.log(
      `🏪 Joined tenant room: ${restaurantRoomName}`
    );

    /*
     * ------------------------------------------------
     * CUSTOMER ORDER TRACKER
     * ------------------------------------------------
     *
     * orderId alone is NOT trusted.
     *
     * This should be authorized before joining.
     */
    socket.on(
      "join_order_tracker",
      async (orderId) => {
        try {
          if (!orderId) {
            return;
          }

          /*
           * IMPORTANT:
           * We do NOT blindly join orderId.
           *
           * Import your Order model here if you want
           * server-side ownership validation.
           */
          const Order = require("../models/Order");

          const order = await Order.findOne({
            _id: orderId,
            restaurantId: restaurantId,
          })
            .select("_id restaurantId")
            .lean();

          if (!order) {
            console.warn(
              `🚫 Unauthorized order room request | socket=${socket.id} | order=${orderId} | restaurant=${restaurantId}`
            );

            socket.emit(
              "ORDER_TRACKER_ERROR",
              {
                message:
                  "Order tracking is not authorized.",
              }
            );

            return;
          }

          const room =
            orderRoom(orderId);

          socket.join(room);

          console.log(
            `📡 Socket ${socket.id} joined ${room}`
          );
        } catch (error) {
          console.error(
            "❌ Order tracker room error:",
            error.message
          );
        }
      }
    );

    /*
     * ------------------------------------------------
     * DISCONNECT
     * ------------------------------------------------
     */
    socket.on(
      "disconnect",
      (reason) => {
        console.log(
          `🔴 Socket disconnected | ${socket.id} | restaurant=${restaurantId} | reason=${reason}`
        );
      }
    );

    /*
     * ------------------------------------------------
     * ERROR
     * ------------------------------------------------
     */
    socket.on(
      "error",
      (error) => {
        console.error(
          `❌ Socket error | ${socket.id}:`,
          error
        );
      }
    );
  });

  console.log(
    "🚀 Secure multi-tenant Socket.IO initialized"
  );

  return io;
};

/*
 * --------------------------------------------------
 * GET IO
 * --------------------------------------------------
 */

const getIO = () => {
  if (!io) {
    throw new Error(
      "Socket.io layer has not been initialized yet!"
    );
  }

  return io;
};

/*
 * --------------------------------------------------
 * TENANT-SAFE EMITTERS
 * --------------------------------------------------
 *
 * Controllers/services should use these instead of
 * manually constructing room names everywhere.
 */

const emitToRestaurant = (
  restaurantId,
  event,
  payload
) => {
  if (!restaurantId) {
    return;
  }

  getIO()
    .to(restaurantRoom(restaurantId))
    .emit(event, payload);
};

const emitToOrder = (
  orderId,
  event,
  payload
) => {
  if (!orderId) {
    return;
  }

  getIO()
    .to(orderRoom(orderId))
    .emit(event, payload);
};

module.exports = {
  initSocket,
  getIO,
  emitToRestaurant,
  emitToOrder,
  restaurantRoom,
  orderRoom,
};