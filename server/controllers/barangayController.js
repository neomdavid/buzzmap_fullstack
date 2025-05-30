const mongoose = require("mongoose");
const barangaysData = require("../data/barangays.json");
const asyncErrorHandler = require("../middleware/asyncErrorHandler");
const Barangay = require("../models/Barangays");
const RecommendationTemplate = require("../models/RecommendationTemplates");
const axios = require("axios");

const getAllBarangays = asyncErrorHandler(async (req, res) => {
  const barangays = await Barangay.find({});

  res.status(200).json(barangays);
});

const getRecentReportsForBarangay = asyncErrorHandler(async (req, res) => {
  const { barangay_name } = req.query;

  if (!barangay_name) {
    return res.status(400).json({ message: "Barangay name is required." });
  }

  try {
    const response = await axios.get(
      `http://localhost:8000/api/v1/recent-reports?barangay=${encodeURIComponent(
        barangay_name
      )}`
    );

    return res.status(200).json({
      barangay: barangay_name,
      reports: response.data,
    });
  } catch (error) {
    console.error("Error calling FastAPI service:", error.message);
    return res
      .status(500)
      .json({ message: "Failed to retrieve reports for the barangay." });
  }
});

const retrieveSpecificBarangayInfo = asyncErrorHandler(async (req, res) => {
  const barangay_name = req.query.barangay;

  if (!barangay_name) {
    return res.status(400).json({ message: "Barangay name is required." });
  }

  try {
    const response = await axios.get(
      `http://localhost:8000/api/v1/specific-barangay-info?barangay_name=${encodeURIComponent(
        barangay_name
      )}`
    );

    // Get barangay data with enhanced recommendation
    const barangay = await Barangay.findOne({ name: barangay_name });

    return res.status(200).json({
      ...response.data,
      barangay_details: barangay,
    });
  } catch (error) {
    console.error("Error calling FastAPI service:", error.message);
    return res
      .status(500)
      .json({ message: "Failed to retrieve barangay information." });
  }
});

module.exports = {
  getAllBarangays,
  getRecentReportsForBarangay,
  retrieveSpecificBarangayInfo,
};
