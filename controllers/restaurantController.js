const mongoose = require("mongoose");
const Restaurant = require("../models/Restaurant");
const QRCode = require("qrcode");
const cloudinary = require("../config/cloudinary");
const { emitToRestaurant } = require("../services/socketService");

/*
|--------------------------------------------------------------------------
| CONSTANTS
|--------------------------------------------------------------------------
*/

const MAX_NAME_LENGTH = 120;
const MAX_SLUG_LENGTH = 80;
const MAX_PHONE_LENGTH = 20;
const MAX_EMAIL_LENGTH = 150;

const MAX_STREET_LENGTH = 250;
const MAX_CITY_LENGTH = 100;
const MAX_STATE_LENGTH = 100;
const MAX_ZIP_LENGTH = 12;

const UPI_REGEX =
  /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/;

const EMAIL_REGEX =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PHONE_REGEX =
  /^\+?[0-9()\-\s]{7,20}$/;

const SLUG_REGEX =
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

const getTenantId = (req) => {
  const restaurantId =
    req.user?.restaurantId;

  if (!restaurantId) {
    return null;
  }

  const id =
    typeof restaurantId === "object"
      ? restaurantId?._id
      : restaurantId;

  return id ? String(id) : null;
};

const isValidObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id);

const cleanString = (
  value,
  maxLength
) => {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
};

const cleanSlug = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH);
};

/*
|--------------------------------------------------------------------------
| CLOUDINARY UPLOAD
|--------------------------------------------------------------------------
*/

const uploadBufferToCloudinary = (
  buffer,
  folder
) =>
  new Promise((resolve, reject) => {
    const uploadStream =
      cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: "image",

          transformation: [
            {
              width: 1000,
              height: 1000,
              crop: "limit",
              quality: "auto",
              fetch_format: "auto",
            },
          ],
        },

        (error, result) => {
          if (error) {
            return reject(error);
          }

          resolve(result);
        }
      );

    uploadStream.end(buffer);
  });

/*
|--------------------------------------------------------------------------
| UPDATE PROFILE
|--------------------------------------------------------------------------
*/

exports.updateRestaurantProfile =
  async (req, res) => {
    try {
      /*
       * --------------------------------------------------
       * TENANT
       * --------------------------------------------------
       */

      const restaurantId =
        getTenantId(req);

      if (
        !restaurantId ||
        !isValidObjectId(restaurantId)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid restaurant context",
        });
      }

      /*
       * --------------------------------------------------
       * LOAD ONLY CURRENT TENANT
       * --------------------------------------------------
       */

      const restaurant =
        await Restaurant.findOne({
          _id: restaurantId,
        }).select(
          "_id name slug phone email themeColor address upiId upiQrCode logo isActive isApproved"
        );

      if (!restaurant) {
        return res.status(404).json({
          success: false,
          message:
            "Restaurant not found",
        });
      }

      /*
       * Disabled restaurant should not be
       * modified through normal restaurant panel.
       */

      if (
        restaurant.isActive === false
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Restaurant account is disabled",
        });
      }

      const updates = {};

      /*
       * --------------------------------------------------
       * NAME
       * --------------------------------------------------
       */

      if (
        req.body.name !== undefined
      ) {
        const name = cleanString(
          req.body.name,
          MAX_NAME_LENGTH
        );

        if (!name) {
          return res.status(400).json({
            success: false,
            message:
              "Restaurant name is required",
          });
        }

        updates.name = name;
      }

      /*
       * --------------------------------------------------
       * SLUG
       * --------------------------------------------------
       */

      if (
        req.body.slug !== undefined
      ) {
        const slug = cleanSlug(
          req.body.slug
        );

        if (
          !slug ||
          !SLUG_REGEX.test(slug)
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid restaurant slug",
          });
        }

        /*
         * Tenant-independent uniqueness.
         *
         * Two restaurants must never
         * share the same public slug.
         */

        const existing =
          await Restaurant.findOne({
            slug,
            _id: {
              $ne: restaurant._id,
            },
          })
            .select("_id")
            .lean();

        if (existing) {
          return res.status(409).json({
            success: false,
            message:
              "This restaurant URL is already in use",
          });
        }

        updates.slug = slug;
      }

      /*
       * --------------------------------------------------
       * PHONE
       * --------------------------------------------------
       */

      if (
        req.body.phone !== undefined
      ) {
        const phone = cleanString(
          req.body.phone,
          MAX_PHONE_LENGTH
        );

        if (
          phone &&
          !PHONE_REGEX.test(phone)
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid phone number",
          });
        }

        updates.phone = phone;
      }

      /*
       * --------------------------------------------------
       * EMAIL
       * --------------------------------------------------
       */

      if (
        req.body.email !== undefined
      ) {
        const email =
          cleanString(
            req.body.email,
            MAX_EMAIL_LENGTH
          ).toLowerCase();

        if (
          email &&
          !EMAIL_REGEX.test(email)
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid email address",
          });
        }

        updates.email = email;
      }

      /*
       * --------------------------------------------------
       * THEME COLOR
       * --------------------------------------------------
       */

      if (
        req.body.themeColor !== undefined
      ) {
        const themeColor =
          cleanString(
            req.body.themeColor,
            20
          );

        if (
          !/^#[0-9A-Fa-f]{6}$/.test(
            themeColor
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid theme color",
          });
        }

        updates.themeColor =
          themeColor;
      }

      /*
       * --------------------------------------------------
       * UPI
       * --------------------------------------------------
       */

      if (
        req.body.upiId !== undefined
      ) {
        const requestedUpi =
          typeof req.body.upiId ===
          "string"
            ? req.body.upiId
                .trim()
                .toLowerCase()
            : "";

        /*
         * UPI is immutable after
         * first successful configuration.
         */

        if (restaurant.upiId) {
          if (
            !requestedUpi ||
            requestedUpi !==
              restaurant.upiId.toLowerCase()
          ) {
            return res.status(403).json({
              success: false,
              code: "UPI_LOCKED",
              message:
                "UPI ID is already configured and cannot be changed. Please contact platform admin.",
            });
          }
        } else {
          /*
           * First-time setup.
           */

          if (!requestedUpi) {
            updates.upiId = "";
            updates.upiQrCode = "";
          } else {
            if (
              !UPI_REGEX.test(
                requestedUpi
              )
            ) {
              return res.status(400).json({
                success: false,
                code: "INVALID_UPI_ID",
                message:
                  "Please enter a valid UPI ID",
              });
            }

            const restaurantName =
              updates.name ||
              restaurant.name ||
              "Restaurant";

            const upiString =
              `upi://pay?pa=${encodeURIComponent(
                requestedUpi
              )}` +
              `&pn=${encodeURIComponent(
                restaurantName
              )}` +
              `&cu=INR`;

            let qrCode;

            try {
              qrCode =
                await QRCode.toDataURL(
                  upiString,
                  {
                    errorCorrectionLevel:
                      "H",
                    margin: 2,
                    scale: 6,
                    color: {
                      dark: "#000000",
                      light: "#FFFFFF",
                    },
                  }
                );
            } catch (qrError) {
              console.error(
                "QR generation failed:",
                qrError
              );

              return res.status(500).json({
                success: false,
                message:
                  "Unable to generate payment QR",
              });
            }

            updates.upiId =
              requestedUpi;

            updates.upiQrCode =
              qrCode;
          }
        }
      }

      /*
       * --------------------------------------------------
       * ADDRESS
       * --------------------------------------------------
       *
       * Supports both:
       *
       * address: {...}
       *
       * and multipart:
       *
       * address[street]
       */

      const hasObjectAddress =
        req.body.address &&
        typeof req.body.address ===
          "object";

      const hasMultipartAddress =
        req.body[
          "address[street]"
        ] !== undefined ||
        req.body[
          "address[city]"
        ] !== undefined ||
        req.body[
          "address[state]"
        ] !== undefined ||
        req.body[
          "address[zip]"
        ] !== undefined;

      if (
        hasObjectAddress ||
        hasMultipartAddress
      ) {
        const source =
          hasObjectAddress
            ? req.body.address
            : req.body;

        const current =
          restaurant.address || {};

        updates.address = {
          street:
            source.street !==
            undefined
              ? cleanString(
                  source.street,
                  MAX_STREET_LENGTH
                )
              : current.street || "",

          city:
            source.city !==
            undefined
              ? cleanString(
                  source.city,
                  MAX_CITY_LENGTH
                )
              : current.city || "",

          state:
            source.state !==
            undefined
              ? cleanString(
                  source.state,
                  MAX_STATE_LENGTH
                )
              : current.state || "",

          zip:
            source.zip !==
            undefined
              ? cleanString(
                  source.zip,
                  MAX_ZIP_LENGTH
                )
              : current.zip || "",
        };
      }

      /*
       * --------------------------------------------------
       * LOGO
       * --------------------------------------------------
       */

      if (req.file) {
        if (
          !ALLOWED_IMAGE_TYPES.has(
            req.file.mimetype
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Only JPG, PNG and WebP images are allowed",
          });
        }

        if (
          req.file.size >
          5 * 1024 * 1024
        ) {
          return res.status(413).json({
            success: false,
            message:
              "Logo image must be smaller than 5MB",
          });
        }

        try {
          const uploadResult =
            await uploadBufferToCloudinary(
              req.file.buffer,
              "chotu/restaurants/logos"
            );

          updates.logo =
            uploadResult.secure_url;
        } catch (uploadError) {
          console.error(
            "Cloudinary upload failed:",
            uploadError
          );

          return res.status(502).json({
            success: false,
            message:
              "Unable to upload restaurant logo",
          });
        }
      }

      /*
       * --------------------------------------------------
       * NOTHING TO UPDATE
       * --------------------------------------------------
       */

      if (
        Object.keys(updates).length ===
        0
      ) {
        return res.status(200).json({
          success: true,
          message:
            "No changes were required",
          data: restaurant,
        });
      }

      /*
       * --------------------------------------------------
       * ATOMIC TENANT-SCOPED UPDATE
       * --------------------------------------------------
       */

      const updatedRestaurant =
        await Restaurant.findOneAndUpdate(
          {
            _id: restaurantId,
          },
          {
            $set: updates,
          },
          {
            new: true,
            runValidators: true,
          }
        )
          .select(
            "_id name slug phone email themeColor address logo upiId upiQrCode isActive isApproved"
          )
          .lean();

      if (!updatedRestaurant) {
        return res.status(404).json({
          success: false,
          message:
            "Restaurant not found",
        });
      }

      /*
       * --------------------------------------------------
       * REALTIME TENANT EVENT
       * --------------------------------------------------
       */

      emitToRestaurant(
        restaurantId,
        "RESTAURANT_PROFILE_UPDATED",
        {
          restaurantId,
          changes: Object.keys(updates),
        }
      );

      return res.status(200).json({
        success: true,
        message:
          "Restaurant profile updated successfully",
        data: updatedRestaurant,
      });
    } catch (error) {
      /*
       * Mongo unique index protection.
       */

      if (
        error?.code === 11000
      ) {
        return res.status(409).json({
          success: false,
          message:
            "Restaurant slug is already in use",
        });
      }

      console.error(
        "Update Restaurant Profile:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to update restaurant profile",
      });
    }
  };

/*
|--------------------------------------------------------------------------
| PUBLIC RESTAURANT DETAILS
|--------------------------------------------------------------------------
*/

exports.getPublicRestaurantDetails =
  async (req, res) => {
    try {
      const slug = cleanSlug(
        req.params?.slug
      );

      if (!slug) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid restaurant slug",
        });
      }

      /*
       * IMPORTANT:
       *
       * Public endpoint must NEVER
       * return complete Restaurant document.
       */

      const restaurant =
        await Restaurant.findOne({
          slug,
          isActive: true,
        })
          .select(
            "_id name slug logo themeColor address isActive"
          )
          .lean();

      if (!restaurant) {
        return res.status(404).json({
          success: false,
          message:
            "Restaurant not found or disabled",
        });
      }

      return res.status(200).json({
        success: true,
        data: restaurant,
      });
    } catch (error) {
      console.error(
        "Get Public Restaurant:",
        error.message
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load restaurant",
      });
    }
  };

/*
|--------------------------------------------------------------------------
| ADMIN PROFILE
|--------------------------------------------------------------------------
*/

exports.getRestaurantProfile =
  async (req, res) => {
    try {
      const restaurantId =
        getTenantId(req);

      if (
        !restaurantId ||
        !isValidObjectId(restaurantId)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid restaurant context",
        });
      }

      /*
       * Explicit tenant-scoped query.
       */

      const restaurant =
        await Restaurant.findOne({
          _id: restaurantId,
        })
          .select(
            "_id name slug phone email themeColor address logo upiId upiQrCode isActive isApproved"
          )
          .lean();

      if (!restaurant) {
        return res.status(404).json({
          success: false,
          message:
            "Restaurant not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: restaurant,
      });
    } catch (error) {
      console.error(
        "Get Restaurant Profile:",
        error.message
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load restaurant profile",
      });
    }
  };