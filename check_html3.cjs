const http = require('http');
http.get('http://localhost:3001/api/chat/snapshot', (res) => {
    let raw = '';
    res.on('data', chunk => raw += chunk);
    res.on('end', () => {
        const data = JSON.parse(raw);
        const html = data.html;

        // Let's find "Thought for"
        const idx = html.indexOf('Thought for');
        if (idx !== -1) {
            // Find the <div class="isolate">... string
            const idxIsolate = html.lastIndexOf('isolate', idx);
            if (idxIsolate !== -1) {
                // Get 1000 characters before isolate
                const snippet = html.substring(Math.max(0, idxIsolate - 1000), idx + 100);
                console.log("HTML before isolate:");
                console.log("...");
                const lines = snippet.replace(/></g, '>\\n<').split('\\n');
                console.log(lines.slice(-15).join('\\n'));
            }
        } else {
            console.log("Thought for NOT FOUND in HTML");
        }
    });
});
