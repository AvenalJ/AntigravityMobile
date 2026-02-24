const http = require('http');
const fs = require('fs');
http.get('http://localhost:3001/api/chat/snapshot', (res) => {
    let raw = '';
    res.on('data', chunk => raw += chunk);
    res.on('end', () => {
        const data = JSON.parse(raw);
        fs.writeFileSync('dump.css', data.css || '');
        console.log("Dumped css");
    });
});
