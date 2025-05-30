const Account = require("../models/Accounts");
const { BadRequestError, NotFoundError } = require("../errors");
const mongoose = require("mongoose");
const { sendOTPVerificationEmail } = require("../services/emailService");

const ALLOWED_ROLES = ["admin", "user", "superadmin"];
const EMAIL_REGEX = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
const ALLOWED_UPDATE_FIELDS = ["username", "email", "password", "role"];

// Get all accounts (excluding deleted ones by default)
const getAllAccounts = async (req, res) => {
  try {
    const accounts = await Account.find({})
      .select('_id username email role authProvider status createdAt updatedAt')
      .sort({ createdAt: -1 });
    res.status(200).json(accounts);
  } catch (error) {
    console.error('Error in getAllAccounts:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

// Get accounts by role/type (excluding deleted ones)
const getAccountsByType = async (req, res) => {
  const { role } = req.params;
  const accounts = await Account.find({ 
    role,
    status: { $ne: "deleted" }
  })
    .select('_id username email role authProvider status createdAt updatedAt')
    .sort({ createdAt: -1 });
  res.status(200).json(accounts);
};

// Create a new account
const createAccount = async (req, res) => {
  const { username, email, password, role, authProvider = "local" } = req.body;
  
  // Validate username
  if (!username || typeof username !== "string" || username.trim() === "") {
    return res.status(400).json({ error: "Username is required and must be a non-empty string." });
  }
  
  // Validate email
  if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email)) {
    return res.status(400).json({ error: "A valid email is required." });
  }
  
  // Validate password (only required for local auth)
  if (authProvider === "local" && (!password || typeof password !== "string" || password.length < 8)) {
    return res.status(400).json({ error: "Password is required and must be at least 8 characters for local authentication." });
  }
  
  // Validate role
  if (!role || !ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({ error: "Invalid role value. Allowed roles: admin, user, superadmin." });
  }

  // Validate authProvider
  if (!["local", "google"].includes(authProvider)) {
    return res.status(400).json({ error: "Invalid auth provider. Must be either 'local' or 'google'." });
  }

  // Check for existing active account
  const existingActive = await Account.findOne({ 
    email,
    status: { $nin: ["deleted", "archived"] }  // Check for accounts that are not deleted or archived
  });
  
  if (existingActive) {
    return res.status(400).json({ error: "Account with this email already exists." });
  }

  // Check for deleted/archived account with same email and permanently delete it
  const deletedAccount = await Account.findOne({ 
    email,
    status: { $in: ["deleted", "archived"] }
  });

  if (deletedAccount) {
    await Account.findByIdAndDelete(deletedAccount._id);
  }

  // Create account with explicit timestamps and status
  const now = new Date();
  const account = await Account.create({
    username,
    email,
    password: authProvider === "local" ? password : undefined,
    role,
    authProvider,
    status: authProvider === "google" ? "active" : "pending",
    createdAt: now,
    updatedAt: now
  });

  // Only send OTP for local authentication
  if (authProvider === "local") {
    const result = await sendOTPVerificationEmail(account);

    if (result.status === "Failed") {
      return res.status(201).json({
        message: "Account created but failed to send verification email. Please request a new OTP.",
        account: await Account.findById(account._id)
          .select('_id username email role authProvider status createdAt updatedAt')
      });
    }
  }

  // Return account without password
  const accountWithoutPassword = await Account.findById(account._id)
    .select('_id username email role authProvider status createdAt updatedAt');
  
  res.status(201).json({
    message: authProvider === "local" 
      ? "Account created successfully. Please check your email to activate your account."
      : "Account created successfully.",
    account: accountWithoutPassword
  });
};

// Update an account
const updateAccount = async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid account ID format." });
  }
  // Only allow updates to allowed fields
  const updateFields = Object.keys(updates);
  const invalidFields = updateFields.filter((field) => !ALLOWED_UPDATE_FIELDS.includes(field));
  if (invalidFields.length > 0) {
    return res.status(400).json({ error: `Invalid update fields: ${invalidFields.join(", ")}` });
  }
  // Validate each field if present
  if (updates.username !== undefined && (typeof updates.username !== "string" || updates.username.trim() === "")) {
    return res.status(400).json({ error: "Username must be a non-empty string." });
  }
  if (updates.email !== undefined && (typeof updates.email !== "string" || !EMAIL_REGEX.test(updates.email))) {
    return res.status(400).json({ error: "Email must be valid." });
  }
  if (updates.password !== undefined && (typeof updates.password !== "string" || updates.password.length < 8)) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  if (updates.role !== undefined && !ALLOWED_ROLES.includes(updates.role)) {
    return res.status(400).json({ error: "Invalid role value. Allowed roles: admin, user, superadmin." });
  }
  const account = await Account.findByIdAndUpdate(id, updates, { 
    new: true,
    select: '_id username email role authProvider status createdAt updatedAt'
  });
  if (!account) {
    return res.status(404).json({ error: "Account not found." });
  }
  res.status(200).json(account);
};

// Delete an account (soft delete)
const deleteAccount = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid account ID format." });
  }

  const account = await Account.findById(id);
  if (!account) {
    return res.status(404).json({ error: "Account not found." });
  }

  // Soft delete by updating status and deletedAt
  account.status = "deleted";
  account.deletedAt = new Date();
  account.updatedAt = new Date();
  await account.save();

  res.status(200).json({
    message: "Account has been archived successfully.",
    account: await Account.findById(id)
      .select('_id username email role authProvider status createdAt updatedAt deletedAt')
  });
};

// Restore a deleted account
const restoreAccount = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid account ID format." });
  }

  const account = await Account.findById(id);
  if (!account) {
    return res.status(404).json({ error: "Account not found." });
  }

  if (account.status !== "deleted") {
    return res.status(400).json({ error: "Account is not deleted." });
  }

  // Restore account by setting status to active and clearing deletedAt
  account.status = "active";
  account.deletedAt = null;
  account.updatedAt = new Date();
  await account.save();

  res.status(200).json({
    message: "Account has been restored successfully.",
    account: await Account.findById(id)
      .select('_id username email role authProvider status createdAt updatedAt deletedAt')
  });
};

// Delete all accounts (soft delete)
const deleteAllAccounts = async (req, res) => {
  try {
    await Account.updateMany(
      { status: { $ne: "deleted" } },
      { 
        status: "deleted",
        updatedAt: new Date()
      }
    );
    res.status(200).json({ message: "All accounts have been archived successfully" });
  } catch (error) {
    console.error('Error archiving all accounts:', error);
    res.status(500).json({ error: 'Failed to archive all accounts' });
  }
};

// Add this new function
const addTimestampsToExistingAccounts = async (req, res) => {
  try {
    const accounts = await Account.find({});
    const updatePromises = accounts.map(account => {
      if (!account.createdAt) {
        const creationDate = account._id.getTimestamp();
        return Account.findByIdAndUpdate(account._id, {
          createdAt: creationDate,
          updatedAt: creationDate
        }, { new: true });
      }
    });
    
    await Promise.all(updatePromises.filter(Boolean));
    res.status(200).json({ message: "Timestamps added to existing accounts" });
  } catch (error) {
    console.error('Error adding timestamps:', error);
    res.status(500).json({ error: 'Failed to add timestamps' });
  }
};

// Toggle account status (active/disabled/banned)
const toggleAccountStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid account ID format." });
  }

  // First get the account to check its role
  const account = await Account.findById(id);
  if (!account) {
    return res.status(404).json({ error: "Account not found." });
  }

  // Validate status based on role
  if (account.role === "user" && status === "disabled") {
    return res.status(400).json({ error: "User accounts cannot be disabled. Use 'banned' instead." });
  }
  if ((account.role === "admin" || account.role === "superadmin") && status === "banned") {
    return res.status(400).json({ error: "Admin accounts cannot be banned. Use 'disabled' instead." });
  }

  // Prevent banning pending or deleted accounts
  if (status === "banned" && (account.status === "pending" || account.status === "deleted")) {
    return res.status(400).json({ 
      error: `Cannot ban an account that is ${account.status}. Account must be active first.` 
    });
  }

  if (!["active", "disabled", "banned", "pending"].includes(status)) {
    return res.status(400).json({ error: "Invalid status. Must be either 'active', 'disabled', 'banned', or 'pending'." });
  }

  const updatedAccount = await Account.findByIdAndUpdate(
    id,
    { 
      status,
      updatedAt: new Date()
    },
    { 
      new: true,
      select: '_id username email role authProvider status createdAt updatedAt'
    }
  );

  let statusMessage = status;
  if (status === 'active') statusMessage = 'activated';
  if (status === 'pending') statusMessage = 'set to pending';

  res.status(200).json({
    message: `Account ${statusMessage} successfully`,
    account: updatedAccount
  });
};

// Get deleted accounts
const getDeletedAccounts = async (req, res) => {
  try {
    const accounts = await Account.find({ status: "deleted" })
      .select('_id username email role authProvider status createdAt updatedAt deletedAt')
      .sort({ deletedAt: -1 });
    res.status(200).json(accounts);
  } catch (error) {
    console.error('Error in getDeletedAccounts:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

// Get account activity (last login, etc.)
const getAccountActivity = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid account ID format." });
  }

  const account = await Account.findById(id)
    .select('_id username email role authProvider status createdAt updatedAt deletedAt lastLoginAt loginAttempts');
  
  if (!account) {
    return res.status(404).json({ error: "Account not found." });
  }

  res.status(200).json({
    account,
    activity: {
      created: account.createdAt,
      lastUpdated: account.updatedAt,
      lastLogin: account.lastLoginAt,
      loginAttempts: account.loginAttempts,
      deletedAt: account.deletedAt,
      isLocked: account.isLocked()
    }
  });
};

// Get accounts by status
const getAccountsByStatus = async (req, res) => {
  const { status } = req.params;
  if (!["pending", "active", "disabled", "banned", "deleted"].includes(status)) {
    return res.status(400).json({ error: "Invalid status value." });
  }

  try {
    const accounts = await Account.find({ status })
      .select('_id username email role authProvider status createdAt updatedAt deletedAt lastLoginAt')
      .sort({ createdAt: -1 });
    res.status(200).json(accounts);
  } catch (error) {
    console.error('Error in getAccountsByStatus:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

// Get account statistics
const getAccountStats = async (req, res) => {
  try {
    const stats = await Account.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          accounts: { $push: "$$ROOT" }
        }
      }
    ]);

    const totalAccounts = await Account.countDocuments();
    const activeAccounts = await Account.countDocuments({ status: "active" });
    const pendingAccounts = await Account.countDocuments({ status: "pending" });
    const deletedAccounts = await Account.countDocuments({ status: "deleted" });
    const bannedAccounts = await Account.countDocuments({ status: "banned" });
    const disabledAccounts = await Account.countDocuments({ status: "disabled" });

    res.status(200).json({
      total: totalAccounts,
      byStatus: {
        active: activeAccounts,
        pending: pendingAccounts,
        deleted: deletedAccounts,
        banned: bannedAccounts,
        disabled: disabledAccounts
      },
      details: stats
    });
  } catch (error) {
    console.error('Error in getAccountStats:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

// Permanently delete an account
const permanentlyDeleteAccount = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid account ID format." });
  }

  const account = await Account.findById(id);
  if (!account) {
    return res.status(404).json({ error: "Account not found." });
  }

  // Permanently delete the account
  await Account.findByIdAndDelete(id);

  res.status(200).json({
    message: "Account has been permanently deleted.",
    deletedAccount: {
      _id: account._id,
      username: account.username,
      email: account.email,
      role: account.role,
      status: account.status,
      deletedAt: new Date()
    }
  });
};

module.exports = {
  getAllAccounts,
  getAccountsByType,
  createAccount,
  updateAccount,
  deleteAccount,
  restoreAccount,
  deleteAllAccounts,
  addTimestampsToExistingAccounts,
  toggleAccountStatus,
  getDeletedAccounts,
  getAccountActivity,
  getAccountsByStatus,
  getAccountStats,
  permanentlyDeleteAccount
}; 