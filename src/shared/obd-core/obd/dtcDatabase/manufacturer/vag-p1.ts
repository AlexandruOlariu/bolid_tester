/**
 * VAG (VW / Audi / Seat / Skoda) manufacturer-specific powertrain DTC definitions, keyed by the
 * SAE-format code (`P1xxx`; VAG `P3xxx` outside the generic P34xx block would also live here).
 *
 * - Manufacturer definitions: the meaning of a `P1xxx` code is set by the OEM, not by SAE J2012.
 *   These texts follow the long-standing VAG powertrain P1 list shared by the Bosch ME7 (petrol)
 *   and EDC15/EDC16 (TDI) generations; EDC17 mostly reports generic P0/P2 codes instead.
 * - TDI coverage: the P1 codes shared with EDC15/16 (air mass, boost P1555–P1557, EGR, supply
 *   voltage, pedal, CAN) are here. The other TDI systems — glow plugs (P0380–P0384,
 *   P0670–P0684), diesel particulate filter (P2002/P2003, P242F, P2452–P2459, P2463), swirl /
 *   intake-manifold flaps (P2008–P2025) and EGR (P0400–P0409) — are reported with generic SAE
 *   codes on these ECUs and resolve from `generic/`, so they are not duplicated as P1 guesses.
 * - Authored for this project in our own short wording. Nothing here is copied from GPL sources
 *   (e.g. python-OBD `codes.py`, GPL-2). Only codes the author was confident about are included;
 *   uncertain ones are deliberately omitted so they fall back to the range description.
 * - Illustrative until confirmed per car: always cross-check against the module's own text (VCDS /
 *   ODIS label) before acting on a repair. Component names in brackets are the usual VAG part
 *   designations.
 *
 * License: MIT, authored for bolid-tester (see LICENSE at the repository root).
 */
export const VAG_P1: Record<string, string> = {
  // Oxygen sensors / mixture control (ME7)
  P1101: 'O2 sensor bank 1 sensor 1 — voltage too low / air leak',
  P1102: 'O2 sensor heater bank 1 sensor 1 — short to B+',
  P1105: 'O2 sensor heater bank 1 sensor 2 — short to B+',
  P1111: 'O2 control bank 1 — system too lean',
  P1112: 'O2 control bank 1 — system too rich',
  P1113: 'O2 sensor bank 1 sensor 1 — internal resistance too high',
  P1114: 'O2 sensor bank 1 sensor 2 — internal resistance too high',
  P1115: 'O2 sensor heater bank 1 sensor 1 — short to ground',
  P1116: 'O2 sensor heater bank 1 sensor 1 — open circuit',
  P1117: 'O2 sensor heater bank 1 sensor 2 — short to ground',
  P1118: 'O2 sensor heater bank 1 sensor 2 — open circuit',
  P1127: 'Long-term fuel trim (multiplicative) bank 1 — system too rich',
  P1128: 'Long-term fuel trim (multiplicative) bank 1 — system too lean',
  P1129: 'Long-term fuel trim (multiplicative) bank 2 — system too rich',
  P1130: 'Long-term fuel trim (multiplicative) bank 2 — system too lean',
  P1136: 'Long-term fuel trim (additive) bank 1 — system too lean',
  P1137: 'Long-term fuel trim (additive) bank 1 — system too rich',
  P1138: 'Long-term fuel trim (additive) bank 2 — system too lean',
  P1139: 'Long-term fuel trim (additive) bank 2 — system too rich',
  P1176: 'O2 correction behind catalyst bank 1 — limit attained',
  P1196: 'O2 sensor heater bank 1 sensor 1 — electrical malfunction',
  P1197: 'O2 sensor heater bank 2 sensor 1 — electrical malfunction',
  P1198: 'O2 sensor heater bank 1 sensor 2 — electrical malfunction',
  P1199: 'O2 sensor heater bank 2 sensor 2 — electrical malfunction',

  // Air mass / pressure / temperature sensors
  P1141: 'Load calculation cross-check — range / performance',
  P1144: 'Mass air flow sensor (G70) circuit — open / short to ground',
  P1145: 'Mass air flow sensor (G70) circuit — short to B+',
  P1146: 'Mass air flow sensor (G70) — supply voltage malfunction',
  P1155: 'Manifold absolute pressure sensor circuit — short to B+',
  P1156: 'Manifold absolute pressure sensor circuit — open / short to ground',
  P1157: 'Manifold absolute pressure sensor — supply voltage malfunction',
  P1160: 'Intake air temperature sensor circuit — short to ground',
  P1161: 'Intake air temperature sensor circuit — open / short to B+',
  P1162: 'Fuel temperature sensor (G81) circuit — short to ground',
  P1163: 'Fuel temperature sensor (G81) circuit — open / short to B+',
  P1164: 'Fuel temperature sensor (G81) — range / performance / implausible signal',
  P1255: 'Engine coolant temperature sensor (G62) circuit — short to ground',
  P1256: 'Engine coolant temperature sensor (G62) circuit — open / short to B+',
  P1387: 'Control module internal altitude (ambient pressure) sensor — error',

  // Throttle / drive-by-wire (ME7)
  P1171: 'Throttle actuator angle sensor 2 — range / performance',
  P1172: 'Throttle actuator angle sensor 2 — signal too low',
  P1173: 'Throttle actuator angle sensor 2 — signal too high',
  P1542: 'Throttle actuator angle sensor — range / performance',
  P1543: 'Throttle actuator angle sensor — signal too low',
  P1544: 'Throttle actuator angle sensor — signal too high',
  P1545: 'Throttle position control — malfunction',
  P1558: 'Throttle actuator (G186) — electrical malfunction',
  P1559: 'Idle speed control — throttle position adaptation malfunction',
  P1564: 'Idle speed control — throttle position: low voltage during adaptation',
  P1565: 'Idle speed control — throttle position lower limit not attained',
  P1568: 'Idle speed control — throttle position mechanical malfunction',
  P1580: 'Throttle actuator bank 1 — malfunction',
  P1582: 'Idle adaptation — at limit',
  P1388: 'Control module internal drive-by-wire — error',

  // Injectors (electrical)
  P1213: 'Injector circuit cylinder 1 — short to B+',
  P1214: 'Injector circuit cylinder 2 — short to B+',
  P1215: 'Injector circuit cylinder 3 — short to B+',
  P1216: 'Injector circuit cylinder 4 — short to B+',
  P1225: 'Injector circuit cylinder 1 — short to ground',
  P1226: 'Injector circuit cylinder 2 — short to ground',
  P1227: 'Injector circuit cylinder 3 — short to ground',
  P1228: 'Injector circuit cylinder 4 — short to ground',
  P1237: 'Injector circuit cylinder 1 — open circuit',
  P1238: 'Injector circuit cylinder 2 — open circuit',
  P1239: 'Injector circuit cylinder 3 — open circuit',
  P1240: 'Injector circuit cylinder 4 — open circuit',

  // Fuel supply / cooling
  P1250: 'Fuel level too low',
  P1296: 'Cooling system — malfunction',
  P1300: 'Misfire detected — reason: fuel level too low',
  P1500: 'Fuel pump relay circuit — electrical malfunction',
  P1501: 'Fuel pump relay circuit — short to ground',
  P1502: 'Fuel pump relay circuit — short to B+',
  P1541: 'Fuel pump relay circuit — open circuit',
  P1537: 'Engine shut-off solenoid (N109) — malfunction',
  P1538: 'Engine shut-off solenoid (N109) — open / short to ground',

  // Ignition / knock / engine speed and timing
  P1325: 'Cylinder 1 knock control — limit attained',
  P1326: 'Cylinder 2 knock control — limit attained',
  P1327: 'Cylinder 3 knock control — limit attained',
  P1328: 'Cylinder 4 knock control — limit attained',
  P1336: 'Engine torque monitoring — adaptation at limit',
  P1337: 'Camshaft position sensor (G40) bank 1 — short to ground',
  P1338: 'Camshaft position sensor (G40) bank 1 — open / short to B+',
  P1340: 'Crankshaft / camshaft position sensor signals — out of sequence',
  P1341: 'Ignition coil power output stage 1 — short to ground',
  P1343: 'Ignition coil power output stage 2 — short to ground',
  P1345: 'Ignition coil power output stage 3 — short to ground',
  P1355: 'Cylinder 1 ignition circuit — open circuit',
  P1356: 'Cylinder 1 ignition circuit — short to B+',
  P1357: 'Cylinder 1 ignition circuit — short to ground',
  P1358: 'Cylinder 2 ignition circuit — open circuit',
  P1359: 'Cylinder 2 ignition circuit — short to B+',
  P1360: 'Cylinder 2 ignition circuit — short to ground',
  P1361: 'Cylinder 3 ignition circuit — open circuit',
  P1362: 'Cylinder 3 ignition circuit — short to B+',
  P1363: 'Cylinder 3 ignition circuit — short to ground',
  P1364: 'Cylinder 4 ignition circuit — open circuit',
  P1365: 'Cylinder 4 ignition circuit — short to B+',
  P1366: 'Cylinder 4 ignition circuit — short to ground',
  P1386: 'Control module internal knock control circuit — error',
  P1393: 'Ignition coil power output stage 1 — malfunction',
  P1394: 'Ignition coil power output stage 2 — malfunction',
  P1395: 'Ignition coil power output stage 3 — malfunction',
  P1396: 'Engine speed sensor (G28) — missing tooth',
  P1519: 'Intake camshaft control bank 1 — malfunction',
  P1522: 'Intake camshaft control bank 2 — malfunction',
  P1560: 'Maximum engine speed exceeded',

  // EGR / evaporative / secondary air
  P1400: 'EGR valve circuit — electrical malfunction',
  P1401: 'EGR valve circuit — short to ground',
  P1402: 'EGR valve circuit — short to B+',
  P1403: 'EGR system — control deviation',
  P1407: 'EGR temperature sensor — signal too low',
  P1408: 'EGR temperature sensor — signal too high',
  P1410: 'Tank ventilation valve (N80) circuit — short to B+',
  P1425: 'Tank ventilation valve (N80) circuit — short to ground',
  P1426: 'Tank ventilation valve (N80) — open circuit',
  P1420: 'Secondary air injection valve circuit — electrical malfunction',
  P1421: 'Secondary air injection valve circuit — short to ground',

  // Intake manifold changeover / boost
  P1297: 'Turbocharger to throttle body pressure hose — connection fault / leak',
  P1512: 'Intake manifold changeover valve circuit — short to B+',
  P1515: 'Intake manifold changeover valve circuit — short to ground',
  P1516: 'Intake manifold changeover valve — open circuit',
  P1546: 'Boost pressure control valve (N75) — short to B+',
  P1547: 'Boost pressure control valve (N75) — short to ground',
  P1548: 'Boost pressure control valve (N75) — open circuit',
  P1550: 'Charge pressure — control deviation',
  P1555: 'Charge pressure increase — control limit exceeded (overboost)',
  P1556: 'Charge pressure control — negative deviation (underboost)',
  P1557: 'Charge pressure control — positive deviation (overboost)',

  // Speed / cruise / immobiliser / crash
  P1523: 'Crash signal received from airbag control module',
  P1540: 'Vehicle speed sensor — signal too high',
  P1569: 'Cruise control switch — incorrect signal',
  P1570: 'Engine start blocked by immobiliser',

  // Supply voltage / control module
  P1600: 'Power supply terminal 15 — low voltage',
  P1602: 'Power supply (B+) terminal 30 — low voltage',
  P1603: 'Control module — internal malfunction',
  P1606: 'Rough-road / engine torque signal from ABS module — electrical malfunction',
  P1612: 'Engine control module — incorrect coding',
  P1640: 'Control module internal memory (EEPROM) — error',

  // Accelerator pedal
  P1630: 'Accelerator pedal position sensor 1 — signal too low',
  P1631: 'Accelerator pedal position sensor 1 — signal too high',
  P1632: 'Accelerator pedal position sensor 1 — supply voltage malfunction',
  P1633: 'Accelerator pedal position sensor 2 — signal too low',
  P1634: 'Accelerator pedal position sensor 2 — signal too high',
  P1639: 'Accelerator pedal position sensors 1 + 2 — range / performance',

  // Powertrain CAN / MIL
  P1611: 'MIL call-up circuit / transmission control module — short to ground',
  P1613: 'MIL call-up circuit — open / short to B+',
  P1624: 'MIL request signal active',
  P1625: 'Powertrain data bus — implausible message from transmission control',
  P1626: 'Powertrain data bus — missing message from transmission control',
  P1648: 'Powertrain data bus — malfunction',
  P1649: 'Powertrain data bus — missing message from ABS control module',
  P1650: 'Powertrain data bus — missing message from instrument cluster',
  P1676: 'Drive-by-wire MIL circuit — electrical malfunction',
  P1690: 'Malfunction indicator lamp (MIL) — malfunction',
  P1691: 'Malfunction indicator lamp (MIL) — open circuit',
  P1692: 'Malfunction indicator lamp (MIL) — short to ground',
  P1693: 'Malfunction indicator lamp (MIL) — short to B+',
};
