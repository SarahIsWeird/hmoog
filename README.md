# Hackmud OOG

A Node.js library to write out-of-game Hackmud scripts.

Currently, this only supports Windows, but macOS and Linux support will be added soon.

## Usage

```
pnpm i @sarahisweird/hmoog
```

Hackmud must be open for HmOog to work!

## Example

For more specialized stuff, check out the TSDocs of the `HmOog` class!

```ts
import { HmOog } from '@sarahisweird/hmoog';

const oog = new HmOog();

// This must be called before any other calls!
await oog.init();

const result = await oog.runCommand('accts.xfer_gc_to');
/*
{
    command: 'scripts.quine',
    success: false,
    output: {
        colored: {
            raw: 'Use <color=#FF8000FF>scripts</color>.<color=#1EFF00FF>quine</color> to output the source code of your script. Place the following into your script:\n' +
                'return #<color=#9B9B9BFF>fs</color>.scripts.quine()',
            lines: [
                'Use <color=#FF8000FF>scripts</color>.<color=#1EFF00FF>quine</color> to output the source code of your script. Place the following into your script:',
                'return #<color=#9B9B9BFF>fs</color>.scripts.quine()'
            ]
        },
        uncolored: {
            raw: 'Use scripts.quine to output the source code of your script. Place the following into your script:\n' +
                'return #fs.scripts.quine()',
            lines: [
                'Use scripts.quine to output the source code of your script. Place the following into your script:',
                'return #fs.scripts.quine()'
            ]
        }
    }
}
*/
```
