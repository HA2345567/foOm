import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = 8080;
const PUBLIC_DIR = path.join(process.cwd(), 'public');

const server = http.createServer((req, res) => {
  let filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url);
  
  // Safe path traversal prevention
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end('Not Found');
    } else {
      const ext = path.extname(filePath);
      let contentType = 'text/plain';
      if (ext === '.html') contentType = 'text/html';
      if (ext === '.svg') contentType = 'image/svg+xml';
      if (ext === '.png') contentType = 'image/png';
      
      res.setHeader('Content-Type', contentType);
      res.end(data);
    }
  });
});

server.listen(PORT, () => {
  console.log(`SERVER_RUNNING on port ${PORT}`);
});
