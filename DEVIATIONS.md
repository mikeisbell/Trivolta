# Trivolta — Known Deviations

Deviations from INSTRUCTIONS spec that were accepted during diff review. Documented so they are not re-raised as bugs.

---

| # | INSTRUCTIONS File | Deviation | Decision |
|---|-------------------|-----------|----------|
| 1 | INSTRUCTIONS_LOBBY_TESTS.md | `tapOn: text: "Play"` changed to `tapOn: id: "home-play-lobby"` — Maestro 2.4.0 on iOS cannot resolve `text:` for React Native Text components inside TouchableOpacity | Accepted — correct fix, added "Play with friends" button to HomeScreen |
| 2 | INSTRUCTIONS_DAILY_CHALLENGE.md | `heroPlayBtnDone` green style not added — "Completed ✓" button remains purple (`heroPlayBtn`) | Accepted — purple is visually acceptable for v1 |
