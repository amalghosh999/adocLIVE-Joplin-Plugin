const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "src", "manifest.json"), "utf8"));
const jpl = path.join(root, "publish", `${manifest.id}.jpl`);
if (!fs.existsSync(jpl)) throw new Error(`Missing ${jpl}; run npm run dist first`);

const output = path.join(root, "test-lab-dist", "native-verification");
const profile = path.join(output, "profile");
const fixtures = path.join(output, "fixtures");
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });
fs.mkdirSync(fixtures, { recursive: true });
fs.copyFileSync(jpl, path.join(output, path.basename(jpl)));
fs.writeFileSync(path.join(fixtures, "native-smoke.adoc"), `= adocLIVE native smoke

== Clipboard and spellcheck

Synthetic mispelled token and *formatting*.

== Media paths

Test resources whose local names contain spaces, #, and ? through Joplin's attachment UI.

[source,javascript]
----
console.log("native smoke");
----
`);
fs.writeFileSync(path.join(output, "README.txt"), `Disposable adocLIVE native verification workspace

JPL: ${path.basename(jpl)}
Profile: ${profile}
Fixture: fixtures/native-smoke.adoc

Launch Joplin with its profile-directory option pointing at the Profile path, install the copied JPL, import the fixture, and complete docs/test-lab/evidence/NATIVE_JOPLIN_MATRIX.md.
Do not reuse a personal Joplin profile.
`);
console.log(output);
