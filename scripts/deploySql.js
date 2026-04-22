export default async function run(page) {
    console.log("Navigating to Supabase SQL Editor...");
    await page.goto('https://supabase.com/dashboard/project/ryxdqnzyvnrwalylqyvm/sql/new', { waitUntil: 'networkidle2' });
    
    // Wait for the Monaco Editor to be ready
    await page.waitForSelector('.monaco-editor', { timeout: 15000 });
    console.log("Editor found.");

    // Read the SQL file content
    const fs = require('fs');
    const path = require('path');
    const sqlContent = fs.readFileSync(path.resolve('', 'v67_emergency_fix.sql'), 'utf-8');

    // Click inside the editor to focus it
    await page.click('.monaco-editor');

    // Select all existing text and delete it
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');

    // Since puppeteer's type() on monaco can be slow/buggy for large text, a faster way is to set clipboard and paste
    console.log("Pasting SQL content...");
    
    // Using evaluate to set it natively if possible, or using page.evaluate
    await page.evaluate(async (text) => {
        // Find the focused textarea inside monaco and set its value directly or use execCommand
        const textArea = document.querySelector('.monaco-editor textarea');
        if (textArea) {
           textArea.value = text;
           const event = new Event('input', { bubbles: true });
           textArea.dispatchEvent(event);
        } else {
             // Fallback: try navigator clipboard API
             await navigator.clipboard.writeText(text);
        }
    }, sqlContent);

    // If we used clipboard, paste it
    await page.keyboard.down('Control');
    await page.keyboard.press('A'); // Just in case
    await page.keyboard.press('V');
    await page.keyboard.up('Control');

    console.log("Text pasted. Running query...");
    // Press CMD/CTRL + ENTER to execute
    await page.keyboard.down('Control');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Control');

    console.log("Waiting for execution to finish...");
    await new Promise(r => setTimeout(r, 5000));
    console.log("Done.");
}
