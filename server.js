const express = require('express');
const path = require('path');
const http = require('http'); // <-- NEW Core HTTP Module
const dotenv = require('dotenv');
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

dotenv.config();
connectDB();

const app = express();
const server = http.createServer(app); // <-- Attach express application to Native Server framework

// Initialize Socket.io cluster layer context injection mapping
initSocket(server);

// 🛠️ CRITICAL MIDDLEWARES (Inko routes se pehle lagana zaroori hai)
app.use(express.json({ limit: '10mb' })); // To parse incoming JSON request bodies
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // To parse URL-encoded bodies
app.use(cookieParser()); // To parse cookies for credentials/auth

app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

const allowedOrigins = [
  "https://chotu-frontend-ngph.onrender.com", // Production frontend URL
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
app.use('/admin', protect, restrictTo('SUPERADMIN'), adminRoutes);

const PORT = process.env.PORT || 5000;
// CRITICAL: Ab app.listen nahi, balki server.listen hook call karna hai!
server.listen(PORT, () => {
  console.log(`🚀 Scalable real-time network server executing cleanly on port: ${PORT}`);
});
