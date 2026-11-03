# NOTICE

This project, **metalgym88**, is a fork of [openGym](https://github.com/DuarteSantos8/openGym)
by DuarteSantos8.

openGym is licensed under the **GNU Affero General Public License v3.0 or later**
(GNU AGPL-3.0-or-later), included verbatim in the [LICENSE](LICENSE) file of this repository.

metalgym88 contains modifications made for the metalgym88 product (platform integration with
api.djlabs.cl, authentication bridge, wallet/credits UI, and an AI assistant panel).

In accordance with GNU AGPL-3.0 section 13, the complete corresponding source of this fork,
including all modifications, remains available under the same GNU AGPL-3.0-or-later license
in this repository. No warranty. See LICENSE for full terms.

---

# Third-party notices (carried from upstream openGym)

openGym — Copyright (C) 2026 Duarte Santos.
openGym's own code is licensed under the **GNU AGPL v3.0** (see [LICENSE](LICENSE)).

## App store exception

As an additional permission under section 7 of the AGPL v3.0, the copyright holder permits
distribution of the openGym mobile application through app store platforms (such as the
Apple App Store and Google Play) whose terms of service would otherwise be incompatible
with the AGPL, provided the corresponding source code remains available under the AGPL at
the project repository. This permission applies to the distribution channel only and does
not otherwise limit the license.

## Body diagram geometry

The muscle outlines the body maps are drawn from (`src/lib/body-paths.js`) are derived
from [**MuscleMap**](https://github.com/melihcolpan/MuscleMap) by Melih Colpan, used under the
**MIT License** and reproduced below. MuscleMap ships its path data as Swift source rather than
`.svg` files; the paths were converted to a JSON module, its sub-group shapes were dropped, and
nothing else about the artwork was changed.

```
MIT License

Copyright (c) 2026 Melih Colpan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Exercise data & media

The exercise names, instructions (English in `src/lib/exercises-data.js`, other languages in
`src/instr/`), images and animations come from
[**hasaneyldrm/exercises-dataset**](https://github.com/hasaneyldrm/exercises-dataset)
and are **not** covered by openGym's AGPL license — they remain under that dataset's own terms.
If you redistribute metalgym88 with the media included, review the upstream license first.
