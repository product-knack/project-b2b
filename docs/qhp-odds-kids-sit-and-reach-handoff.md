# Handoff: Odds Kids QHP, sit-and-reach (cm) field and the youth norms (web, 2026-09-29)

For the Android session. Web-only change to the standardized QHP form and the new-style QHP PDF; nothing on Android reads or writes it today.

## What changed on web
- The **Odds Kids** goal card of the standardized assessment form (`OddsKidsAssessmentStep.tsx`) gained a seventh test, **Sit and Reach (cm)** (`formData.oddsKidsSitReach`), saved beside the other six as `"Standardized Assessment".assessmentTests.oddsKids.commonTests.sitAndReach` (string, centimetres past the 26 cm footline). Hydrate on edit and the "Previous:" placeholders read it back. The envelope is otherwise unchanged: `commonTests {pacerTest, gripStrength, curlUp, pushups, balanceRight, balanceLeft, sitAndReach}`, `measurements {...}`, `notes`. Odds Kids QHPs still land in `coach_assessment.qhp_data`.
- The new-style QHP PDF (web only, `src/lib/qhpV2/`) now prints the kids' battery in section 4.2 against the owner's age and sex norms for ages 10 to 17 (FITNESSGRAM 2023, Tomkinson 2017, Eurofit; `youthNorm` in `norms.ts`): 20 m PACER (laps), Handgrip (kg), Curl-ups, Push-ups, Sit-and-reach (cm), Stork balance on the weaker leg. A test left blank prints nothing. Rule: L is the healthy zone's lower bound; at or above L on track, 0.9 x L to L monitor, below that priority.

## What Android does not have
- The Android QHP form (`src/screens/qhpAssessmentForm.tsx`) offers Postpartum, Prenatal and Senior Citizen but **no Odds Kids goal**, so kids' QHPs are web-only. If the Odds Kids card is ever ported, write the same seven `commonTests` keys above (all strings), including `sitAndReach`.
- No Android PDF work: the new-style report is generated on web.

## Reference
- Web feature doc: `docs/features/web/trainer/trainer-dashboard.md`, section 9 "New QHP PDF" (Odds Kids battery bullet) and the assessment write paragraph.
