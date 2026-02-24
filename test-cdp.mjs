import * as CDP from './cdp-client.mjs';

async function main() {
    console.log("Connecting to find editor target...");
    const target = await CDP.findEditorTarget();
    if (!target) {
        console.error("No target found");
        return;
    }
    console.log("Target found:", target.title);
    
    const client = await CDP.connectToTarget(target);
    try {
        const result = await client.send('Runtime.evaluate', {
            expression: `
                (function() {
                    function getStructure(el, depth = 0) {
                        if (depth > 6) return null;
                        if (!el || !el.children) return null;
                        let info = [];
                        for (let child of el.children) {
                            let rect = child.getBoundingClientRect();
                            if (rect.width > 200 && rect.height > 100) {
                                let id = child.id ? '#' + child.id : '';
                                let cls = child.className ? '.' + child.className.split(' ').join('.') : '';
                                let text = child.innerText.substring(0, 50).replace(/\\n/g, ' ');
                                info.push({
                                    tag: child.tagName,
                                    id, cls, text,
                                    width: rect.width, height: rect.height,
                                    children: getStructure(child, depth + 1)
                                });
                            }
                        }
                        return info;
                    }
                    return getStructure(document.body);
                })()
            `,
            returnByValue: true
        });
        
        console.log(JSON.stringify(result.result.value, null, 2));
    } finally {
        client.close();
    }
}

main().catch(console.error);
