const express = require('express');
const router = express.Router();

router.get('/v1/models', (req, res) => {
    res.json({
        object: "list",
        data: [{ id: "us.anthropic.claude-sonnet-4-6", object: "model", created: 1700000000, owned_by: "anthropic" }],
    });
});

module.exports = router;
