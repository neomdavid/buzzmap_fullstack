const express = require("express");
const router = express.Router();
const { 
  addComment, 
  getComments, 
  upvoteComment, 
  downvoteComment, 
  removeUpvote, 
  removeDownvote 
} = require("../controllers/commentController");
const auth = require("../middleware/authentication");

router.post("/:reportId", auth, addComment);
router.get("/:reportId", getComments);

// Voting routes
router.post("/:commentId/upvote", auth, upvoteComment);
router.post("/:commentId/downvote", auth, downvoteComment);
router.delete("/:commentId/upvote", auth, removeUpvote);
router.delete("/:commentId/downvote", auth, removeDownvote);

module.exports = router; 