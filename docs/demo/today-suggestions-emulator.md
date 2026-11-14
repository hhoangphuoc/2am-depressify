# Today suggestions: emulator verification

Tested on 14 November 2026, approximately 16:40 to 16:50 Europe/Helsinki, against PR #63 at `d3a660d`. Device: `emulator-5554`, `sdk_gphone64_arm64`, Android 16. The installed debug app uses live Firebase project `junction26hel-7400`, the deployed `suggestToday` callable, Gemini, Places API (New), and a restricted Android Maps SDK key.

## <a id="results"></a>Results

| Check | Aino (`demo-steady`) | Sara (`demo-sparse`) |
|---|---|---|
| Patient identity | Greeting showed Aino (demo). | Greeting showed Sara (demo) after switching from Aino. |
| Context | Suggested the Lauttasaari shore path and referred to earlier helpful walks. | Suggested a brief sit at Arabianranta, referring to her previous experience there. |
| Embedded map | Rendered tiles, patient location circle, place pins and Google attribution around Lauttasaari. | Rendered tiles, patient location circle, place pin and Google attribution between Vallila and Arabianranta. |
| Nearby places | Lauttasaari Beach, Kasinonranta and Valonheittimen jalusta - Pietari Suuri (1915), all with Helsinki addresses. | Arabianranta, 00550 Helsinki. Attribution identified the search origin as her Vallila apartment. |
| Place selection | Selecting Kasinonranta in the list moved the camera and highlighted its pin. | A single result was returned and shown on the map. |
| Maps link | Opened the Kasinonranta page at Pajalahdentie 1 in Google Maps. | Opened the Arabianranta page in Helsinki in Google Maps. |
| Music | Living Room Songs / Olafur Arnalds, Seleniko / Varttina, Blue / Joni Mitchell. The app displayed the artists' accents correctly. | No Ordinary Love / Sade, Dancing On My Own / Robyn, Chasing Highs / Alma. |
| Listen link | Opened YouTube Music with the query `Living%20Room%20Songs%20%C3%93lafur%20Arnalds`. | Opened YouTube Music with the query `Dancing%20On%20My%20Own%20Robyn`. |
| Returning from external apps | Today retained Aino's suggestions and selected place. | Today retained Sara's suggestions after returning from Maps and YouTube Music. |

A fresh app launch without a patient override kept Sara selected and fetched a new set of her own suggestions, including the Vallila allotment gardens. No Depressify process crash appeared in the emulator crash buffer during these checks. No application code fix was required for the tested flows.

## <a id="repeat"></a>Repeat

1. Use the debug build with live Firebase configuration, `demo.patientId` set, and `maps.apiKey` configured in ignored `secrets.properties`.
2. Long-press the Depressify launcher icon and select Aino or Sara. The tests launched the same activity and patient-id extra directly through ADB:

   ```sh
   adb -s emulator-5554 shell am start -S -W \
     -n app.depressify.patient/app.depressify.android.MainActivity \
     --es demoPatientId demo-steady
   ```

   Use `demo-sparse` for Sara.
3. Wait for "For you today" to finish loading. Scroll to the place suggestion; inspect tiles, pins, location attribution and addresses. Select another place when available, then open its Maps link and return.
4. Choose Music, inspect the tracks and artists, tap Listen, and return. Verify that the selected Patient's context is retained.

Generated wording, suggestion kinds, music and place counts can vary on each request; the values above record this run.

## <a id="limits"></a>Limits

YouTube Music was unsigned-in and stopped at its sign-in screen. Link dispatch and query encoding passed; playback was not tested. Google Maps first-run onboarding was skipped and device-location permission was declined; place pages still opened correctly.

This run covers the online Today flows on one emulator. It does not repeat offline, denied-key or service-failure scenarios, or test a physical phone or iOS. Keys and Firebase configuration remain outside Git. Screenshots and UI dumps were inspected locally and are not committed.
