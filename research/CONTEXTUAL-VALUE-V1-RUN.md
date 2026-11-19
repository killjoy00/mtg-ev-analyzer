# contextual-value-v1 real-data development run

This sentinel intentionally triggers the first merged real-data development run
for issue #529.

The workflow evaluates TMT, HOB, and MSH independently from official 17Lands
Premier Draft + Game archives, with a deterministic cap of 3,000 drafts per
environment. It may use train and validation only. The 25% assessment partition
must remain sealed and every report must assert `assessment_opened: false`.

This is a research run only. It cannot modify production scoring, puzzles,
corpus metadata, or the database.
