# ADIF Parser Library

A lightweight, robust ADIF (.adi) parser library for JavaScript/TypeScript.

## Installation

```bash
npm install @sp9lee/adifly
```

## Usage

```js
import { parseAdif } from '@sp9lee/adifly'

const adifContent = '<CALL:5>SP9LEE<EOR>'
const result = parseAdif(adifContent)

console.log(result)
```

## License

This project is licensed under the MIT License.
