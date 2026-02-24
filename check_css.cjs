const http = require('http');
http.get('http://localhost:3001/api/chat/snapshot', (res) => {
    let raw = '';
    res.on('data', chunk => raw += chunk);
    res.on('end', () => {
        const data = JSON.parse(raw);
        const css = data.css || '';
        console.log("Got CSS, length:", css.length);

        // Let's filter css for .isolate
        const rules = css.split('}');
        for (const rule of rules) {
            if (rule.includes('.isolate') || rule.includes('button') || rule.includes('bg-')) {
                if (rule.includes('background') && (rule.includes('gray') || rule.includes('#') || rule.includes('rgb'))) {
                    // Only print suspicious rules
                    if (rule.includes('.isolate') || (rule.includes('button') && !rule.includes('markdown'))) {
                        console.log(rule.trim() + '}');
                    }
                }
            }
        }
    });
});
