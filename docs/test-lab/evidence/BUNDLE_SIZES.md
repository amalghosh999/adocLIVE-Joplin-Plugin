# Bundle and JPL Size Evidence

Measured from the clean pre-Test-Lab production build and the implementation build with the same Node/npm/Webpack environment.

| Artifact | Before | After | Change | Explanation |
|---|---:|---:|---:|---|
| `dist/index.js` | 1,215,006 B | 1,580,100 B | +365,094 B (+30.0%) | Zod protocol validation, capability ports, shared RPC/include/render/conversion cores, and handle lifecycle in the plugin sandbox bundle |
| `dist/panel.js` | 5,700,392 B | 5,996,575 B | +296,183 B (+5.2%) | Zod request/response/push validation and typed production transport |
| generated JPL | 2,846,400 B | 2,982,854 B | +136,454 B (+4.8%) | Compressed effect of the two production bundle changes; no lab source or output is present |

Pre-change hashes:

```text
index.js  6caed0ccca222da3dcb7ca6df8e0d5f90e2be01d0f2844649ad046c8919e1226
panel.js  814766d2569c113d8d1f34aa7ddbdfea6a2c370266bd3c4e3026370a01b737d6
JPL       4766ac0ed2cc8d26ed0538b3cf5334a2a3dc522fdbf8735fc7b64aa9385d5ee9
```

Implementation-build hashes:

```text
index.js  9404fa05d5d29b73da9b4afed19759cf7d71ec08affdd5c258152184dbf3ccbc
panel.js  974b0951c3059c53f9e54e5240af913edbfcf91f25deef56f2e49eaf2a8488bc
JPL       927e91512e799ff8acda8c798893cdc68339ee92ca4bf92d45c1f43106e67c68
```

The growth is attributable to the approved production dependency and boundary code. Artifact inspection confirms that it is not caused by laboratory assets.

## 1.0.4 pre-source-commit security refresh

Measured after the 1.0.4 metadata update and compatible lock refresh, before
the required user-owned clean source commit:

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `dist/index.js` | 1,583,433 | `ce0cffcb026e80d7a40a53da771fd167a88d8becafc4b41646b776ef72ea0aa2` |
| `dist/panel.js` | 6,610,626 | `348007c568dbc6b9ab15234ae8e761e701538ecd0d38ff1ba51b4cff64ddd198` |
| generated JPL | 3,121,990 | `51956c7b95e0906180485dab2b3bff2b0ea9b52dd28ae79d92f1f12217e74f00` |
| npm tarball | 3,137,965 | `0c01ec1bd098c7ff2775e2f53ed3ec935b479e3d46887670d4c1d6e32004fcb5` |
| publish manifest | 749 | `1294a772d7a18eee2b115798206047e3069f4dfe683a723ee7a20502e42cb23c` |

The JPL archive is reproducible: file ordering, ownership, and modification
times are normalized to the source commit before gzip is created without a
timestamp. These hashes therefore prove the local pre-commit build but are not
the canonical release hashes: the clean source commit changes the normalized
archive timestamp and publish-commit metadata. The canonical candidate and
receipt will supersede them and bind the exact publishable JPL and npm tarball.

`npm pack --dry-run --json` confirms that the tarball contains exactly
`LICENSE`, `README.adoc`, `package.json`, and the two files under `publish/`; no
Test Lab, candidate, receipt-draft, browser, or design assets are present.
