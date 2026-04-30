const https = require('https');
https.get('https://api.dictionaryapi.dev/api/v2/entries/en/hello', (res) => {
  let data = '';
  res.on('data', (c) => data += c);
  res.on('end', () => console.log(data));
});
