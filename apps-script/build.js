'use strict';
/*
 * Ghép apps-script/server.src.gs + apps-script/mobile.src.html + src/core.js thành apps-script/Code.gs.
 * Dán nguyên Code.gs vào trình soạn thảo Apps Script (thay toàn bộ nội dung cũ) rồi Deploy phiên bản mới.
 * core.js chỉ có một bản duy nhất ở src/core.js, dùng chung cho app laptop và trang điện thoại.
 */
const fs = require('fs');
const path = require('path');

const MARK = "/*__MOBILE_HTML__*/''";

function build() {
  const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
  const core = read('../src/core.js');
  if (/<\/script/i.test(core)) throw new Error('core.js chứa </script>, không nhúng được vào trang điện thoại');
  const page = read('mobile.src.html');
  if (page.indexOf('<script>/*__CORE__*/</script>') < 0) throw new Error('mobile.src.html thiếu chỗ chèn core.js');
  const html = page.replace('/*__CORE__*/', () => core);
  const server = read('server.src.gs');
  if (server.indexOf(MARK) < 0) throw new Error('server.src.gs thiếu chỗ chèn trang điện thoại');
  return server.replace(MARK, () => JSON.stringify(html));
}

module.exports = { build };

if (require.main === module) {
  const out = path.join(__dirname, 'Code.gs');
  const code = build();
  fs.writeFileSync(out, code);
  console.log('Đã ghi ' + out + ' (' + Math.round(code.length / 1024) + ' KB)');
}
