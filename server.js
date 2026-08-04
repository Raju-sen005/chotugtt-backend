const express = require('express');
const path = require('path');
const http = require('http'); // <-- NEW Core HTTP Module
const dotenv = require('dotenv');
dotenv.config();
const cookieParser = require('cookie-parser');
const cors = require('cors');
const connectDB = require('./config/db');
const { initSocket } = require('./services/socketService'); // <-- NEW Socket Loader
const { protect, restrictTo } = require('./middleware/auth'); // Path check kar lein

// Load endpoints variants
const authRoutes = require('./routes/authRoutes');
const restaurantRoutes = require('./routes/restaurantRoutes');
const menuRoutes = require('./routes/menuRoutes');
const orderRoutes = require('./routes/orderRoutes'); // <-- NEW Route
const adminRoutes = require('./routes/adminRoutes'); // Nayi file banayein
const analyticsRoutes = require('./routes/analyticsRoutes');
const offerRoutes = require("./routes/offerRoutes");
const tableRoutes = require("./routes/Tableroutes"); 
const marketingRoutes = require("./routes/marketingRoutes");
connectDB();

const app = express();
const server = http.createServer(app); // <-- Attach express application to Native Server framework
// Initialize Socket.io cluster layer context injection mapping
initSocket(server);
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
app.use(cookieParser());

// 👇 ADD THESE
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const allowedOrigins = [
  // "http://localhost:5174", // Captain app / Local frontend 1
  // "http://localhost:5173", // Restaurant Admin panel / Local frontend 2 (agar ye port hai)
  "https://chotu-frontend-ngph.onrender.com", // Production frontend URL (agar ho)
  "https://captain-uw3o.onrender.com"
];

app.use(cors({
  origin: function (origin, callback) {
    // Postman ya server-to-server requests ke liye origin undefined ho sakta hai
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Base API endpoints mounts
app.use('/auth', authRoutes);
app.use('/restaurant', restaurantRoutes);
app.use('/menu', menuRoutes);
app.use('/orders', orderRoutes); // <-- NEW MOUNT INTERFACE
app.use('/analytics', analyticsRoutes);
app.use("/offers", offerRoutes);
app.use("/tables", tableRoutes); 
app.use('/marketing', marketingRoutes);
app.use('/admin', protect, restrictTo('SUPERADMIN'), adminRoutes);

const PORT = process.env.PORT || 5000;
// CRITICAL: Ab app.listen nahi, balki server.listen hook call karna hai!
server.listen(PORT, () => {
  console.log(`🚀 Scalable real-time network server executing cleanly on port: ${PORT}`);
});
