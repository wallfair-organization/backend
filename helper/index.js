exports.isAdmin = (req) => !(req.user.admin === false && req.params.userId !== req.user.id);
exports.isLoggedIn = (req, res, next) => req.user ? next() : res.sendStatus(401);
