const fs = require('fs');
const lines = fs.readFileSync('components/DictionaryApp.tsx', 'utf-8').split('\n');
const darkLines = lines.map((line, i) => `${i+1}: ${line}`).filter(line => line.includes('isDarkMode'));
console.log(darkLines.slice(0, 30).join('\n'));
