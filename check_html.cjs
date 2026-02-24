const http = require('http');
http.get('http://localhost:3001/api/chat/snapshot', (res) => {
    let raw = '';
    res.on('data', chunk => raw += chunk);
    res.on('end', () => {
        const data = JSON.parse(raw);
        console.log("Got HTML, length:", data.html.length);
        const html = data.html;

        // Let's find "Thought for"
        const idx = html.indexOf('Thought for');
        if (idx !== -1) {
            const snippet = html.substring(Math.max(0, idx - 500), Math.min(html.length, idx + 200));
            console.log("HTML around 'Thought for':");
            console.log(snippet);
        } else {
            console.log("Thought for NOT FOUND in HTML");
        }
    });
});
