import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEFAULT_PROMPT} from '../src/translate.js';
test('backend default and browser reset template preserve the exact user-supplied prompt',async()=>{
 const expected=await readFile(new URL('./expected-default-prompt.txt',import.meta.url),'utf8');
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 const template=html.match(/<template id="default-prompt">([\s\S]*?)<\/template>/)?.[1];
 assert.equal(DEFAULT_PROMPT,expected);assert.equal(template,expected);
});
