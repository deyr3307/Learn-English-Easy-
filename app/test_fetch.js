const fs = require('fs');

async function testFetch() {
  try {
    console.log("Fetching...");
    const res = await fetch("https://image.pollinations.ai/prompt/apple?width=100&height=100");
    console.log("Status:", res.status);
    const buf = await res.arrayBuffer();
    console.log("Size:", buf.byteLength);
  } catch(e) {
    console.error(e);
  }
}
testFetch();
