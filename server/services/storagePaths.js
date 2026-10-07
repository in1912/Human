// Vivix Human — 上传文件落盘（尽力而为，失败回 '' 由调用方回退 base64 入库）
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { dataDir } = require('../db');

const UPLOAD_ROOT = path.join(dataDir, 'uploads');

// 名字清洗：留字母数字/汉字/._-，压缩杂字符，防路径穿越
function safeName(name) {
  const base = path.basename(String(name || 'file')).replace(/[^\w.一-龥-]+/g, '_').slice(-80);
  return base || 'file';
}

function bestEffortSave(prefix, originalname, buffer, uidPrefix = '') {
  try {
    const dir = path.join(UPLOAD_ROOT, prefix);
    fs.mkdirSync(dir, { recursive: true });
    const name = `${uidPrefix}${Date.now()}_${safeName(originalname)}`;
    const full = path.join(dir, name);
    fs.writeFileSync(full, buffer);
    return full; // 返回绝对路径：dh_images.storage_path 存它，raw 端点直接 existsStats/sendFile
  } catch {
    return ''; // 落盘失败由调用方回退（数字人参考图 ≤4MB 时 base64 入库）
  }
}

module.exports = { UPLOAD_ROOT, bestEffortSave };
