const http = require('http');
http.get('http://localhost:3001/api/chat/snapshot', (res) => {
    let raw = '';
    res.on('data', chunk => raw += chunk);
    res.on('end', () => {
        const data = JSON.parse(raw);
        console.log("Got HTML");
        const match = data.html.match(/<div class="isolate[^>]*>[\s\S]*?Thought for[\s\S]*?<\/button>/g);
        if (match) {
            match.forEach(m => console.log(m));
        } else {
            console.log("Not found 'isolate' div");
            const match2 = data.html.match(/<button[^>]*>[\s\S]*?Thought for[\s\S]*?<\/button>/g);
            if (match2) match2.forEach(m => console.log("Button: ", m));
        }
    });
});
