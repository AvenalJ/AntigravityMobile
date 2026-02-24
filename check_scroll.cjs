const fs = require('fs');

http = require('http');

http.get('http://localhost:3001/api/chat/snapshot', (res) => {
    let raw = '';
    res.on('data', chunk => raw += chunk);
    res.on('end', () => {
        const data = JSON.parse(raw);
        console.log("HTML length:", data.html.length);
        console.log("CSS length:", data.css.length);

        console.log("Found h-full:", data.html.match(/h-full/g)?.length);
        console.log("Found overflow-y-auto:", data.html.match(/overflow-y-auto/g)?.length);
        console.log("Found overflow-hidden:", data.html.match(/overflow-hidden/g)?.length);
        console.log("Found flex-1:", data.html.match(/flex-1/g)?.length);

        fs.writeFileSync('debug_html.html', data.html);
    });
});
