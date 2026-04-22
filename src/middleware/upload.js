'use strict';
const multer = require('multer');

// Guarda em memória para depois inserir como BLOB na BD (igual ao PHP)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter(req, file, cb) {
    const allowed = ['image/jpeg', 'image/png'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('A foto deve estar no formato .jpg ou .png.'));
    }
    cb(null, true);
  },
});

module.exports = upload;
