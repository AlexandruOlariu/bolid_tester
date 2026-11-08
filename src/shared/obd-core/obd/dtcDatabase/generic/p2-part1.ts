/**
 * Generic SAE J2012 / ISO 15031-6 powertrain codes, P2 family part 1: P2000-P24FF.
 *
 * Covers NOx trap / SCR reductant / DPF aftertreatment, intake manifold runner and tuning valves,
 * electronic throttle actuator control, throttle/pedal position sensors, exhaust gas temperature,
 * NOx and O2 sensors, coolant temperature sensor 2, barometric pressure, fuel trim, fuel and
 * injector control pressure, ignition coils, knock, EVAP and secondary air injection.
 *
 * Data sourcing rules (plan 05):
 * - Descriptions are the standardized SAE J2012 / ISO 15031-6 definitions, authored for this
 *   project in short canonical wording. Nothing here is copied from a GPL source (python-OBD's
 *   `codes.py` is GPL-2 and must not be used); no third-party list was used.
 * - Keys are uppercase 5-character codes, no duplicates (dtcDatabase.test.ts enforces this).
 * - Only codes whose generic assignment is well established are listed. Uncertain codes (e.g.
 *   P2348-P23FF and most of P2448-P24FF) are omitted; anything missing falls back to the range
 *   description in `dtcDatabase/index.ts`.
 */
export const P2_PART1: Record<string, string> = {
  // NOx trap / particulate filter efficiency
  P2000: 'NOx Trap Efficiency Below Threshold Bank 1',
  P2001: 'NOx Trap Efficiency Below Threshold Bank 2',
  P2002: 'Diesel Particulate Filter Efficiency Below Threshold Bank 1',
  P2003: 'Diesel Particulate Filter Efficiency Below Threshold Bank 2',

  // Intake manifold runner control
  P2004: 'Intake Manifold Runner Control Stuck Open Bank 1',
  P2005: 'Intake Manifold Runner Control Stuck Open Bank 2',
  P2006: 'Intake Manifold Runner Control Stuck Closed Bank 1',
  P2007: 'Intake Manifold Runner Control Stuck Closed Bank 2',
  P2008: 'Intake Manifold Runner Control Circuit/Open Bank 1',
  P2009: 'Intake Manifold Runner Control Circuit Low Bank 1',
  P2010: 'Intake Manifold Runner Control Circuit High Bank 1',
  P2011: 'Intake Manifold Runner Control Circuit/Open Bank 2',
  P2012: 'Intake Manifold Runner Control Circuit Low Bank 2',
  P2013: 'Intake Manifold Runner Control Circuit High Bank 2',

  // Intake manifold runner position sensor/switch
  P2014: 'Intake Manifold Runner Position Sensor/Switch Circuit Bank 1',
  P2015: 'Intake Manifold Runner Position Sensor/Switch Circuit Range/Performance Bank 1',
  P2016: 'Intake Manifold Runner Position Sensor/Switch Circuit Low Bank 1',
  P2017: 'Intake Manifold Runner Position Sensor/Switch Circuit High Bank 1',
  P2018: 'Intake Manifold Runner Position Sensor/Switch Circuit Intermittent Bank 1',
  P2019: 'Intake Manifold Runner Position Sensor/Switch Circuit Bank 2',
  P2020: 'Intake Manifold Runner Position Sensor/Switch Circuit Range/Performance Bank 2',
  P2021: 'Intake Manifold Runner Position Sensor/Switch Circuit Low Bank 2',
  P2022: 'Intake Manifold Runner Position Sensor/Switch Circuit High Bank 2',
  P2023: 'Intake Manifold Runner Position Sensor/Switch Circuit Intermittent Bank 2',

  // EVAP fuel vapour temperature sensor
  P2024: 'Evaporative Emission (EVAP) Fuel Vapor Temperature Sensor Circuit',
  P2025: 'Evaporative Emission (EVAP) Fuel Vapor Temperature Sensor Performance',
  P2026: 'Evaporative Emission (EVAP) Fuel Vapor Temperature Sensor Circuit Low',
  P2027: 'Evaporative Emission (EVAP) Fuel Vapor Temperature Sensor Circuit High',
  P2028: 'Evaporative Emission (EVAP) Fuel Vapor Temperature Sensor Circuit Intermittent',

  // Fuel fired heater
  P2029: 'Fuel Fired Heater Disabled',
  P2030: 'Fuel Fired Heater Performance',

  // Exhaust gas temperature sensor, sensor 2
  P2031: 'Exhaust Gas Temperature Sensor Circuit Bank 1 Sensor 2',
  P2032: 'Exhaust Gas Temperature Sensor Circuit Low Bank 1 Sensor 2',
  P2033: 'Exhaust Gas Temperature Sensor Circuit High Bank 1 Sensor 2',
  P2034: 'Exhaust Gas Temperature Sensor Circuit Bank 2 Sensor 2',
  P2035: 'Exhaust Gas Temperature Sensor Circuit Low Bank 2 Sensor 2',
  P2036: 'Exhaust Gas Temperature Sensor Circuit High Bank 2 Sensor 2',

  // SCR reductant (urea / AdBlue): air pressure and temperature sensors
  P2037: 'Reductant Injection Air Pressure Sensor Circuit',
  P2038: 'Reductant Injection Air Pressure Sensor Circuit Range/Performance',
  P2039: 'Reductant Injection Air Pressure Sensor Circuit Low Input',
  P2040: 'Reductant Injection Air Pressure Sensor Circuit High Input',
  P2041: 'Reductant Injection Air Pressure Sensor Circuit Intermittent',
  P2042: 'Reductant Temperature Sensor Circuit',
  P2043: 'Reductant Temperature Sensor Circuit Range/Performance',
  P2044: 'Reductant Temperature Sensor Circuit Low Input',
  P2045: 'Reductant Temperature Sensor Circuit High Input',
  P2046: 'Reductant Temperature Sensor Circuit Intermittent',

  // SCR reductant injectors, air pump and supply
  P2047: 'Reductant Injector Circuit/Open Bank 1 Unit 1',
  P2048: 'Reductant Injector Circuit Low Bank 1 Unit 1',
  P2049: 'Reductant Injector Circuit High Bank 1 Unit 1',
  P2050: 'Reductant Injector Circuit/Open Bank 2 Unit 1',
  P2051: 'Reductant Injector Circuit Low Bank 2 Unit 1',
  P2052: 'Reductant Injector Circuit High Bank 2 Unit 1',
  P2053: 'Reductant Injector Circuit/Open Bank 1 Unit 2',
  P2054: 'Reductant Injector Circuit Low Bank 1 Unit 2',
  P2055: 'Reductant Injector Circuit High Bank 1 Unit 2',
  P2056: 'Reductant Injector Circuit/Open Bank 2 Unit 2',
  P2057: 'Reductant Injector Circuit Low Bank 2 Unit 2',
  P2058: 'Reductant Injector Circuit High Bank 2 Unit 2',
  P2059: 'Reductant Injection Air Pump Control Circuit/Open',
  P2060: 'Reductant Injection Air Pump Control Circuit Low',
  P2061: 'Reductant Injection Air Pump Control Circuit High',
  P2062: 'Reductant Supply Control Circuit/Open',
  P2063: 'Reductant Supply Control Circuit Low',
  P2064: 'Reductant Supply Control Circuit High',

  // Fuel level sensor B
  P2065: 'Fuel Level Sensor B Circuit',
  P2066: 'Fuel Level Sensor B Performance',
  P2067: 'Fuel Level Sensor B Circuit Low',
  P2068: 'Fuel Level Sensor B Circuit High',
  P2069: 'Fuel Level Sensor B Circuit Intermittent',

  // Intake manifold tuning valve, throttle/MAP correlation
  P2070: 'Intake Manifold Tuning (IMT) Valve Stuck Open',
  P2071: 'Intake Manifold Tuning (IMT) Valve Stuck Closed',
  P2072: 'Throttle Actuator Control System - Ice Blockage',
  P2073: 'Manifold Absolute Pressure/Mass Air Flow - Throttle Position Correlation at Idle',
  P2074: 'Manifold Absolute Pressure/Mass Air Flow - Throttle Position Correlation at Higher Load',
  P2075: 'Intake Manifold Tuning (IMT) Valve Position Sensor/Switch Circuit',
  P2076: 'Intake Manifold Tuning (IMT) Valve Position Sensor/Switch Circuit Range/Performance',
  P2077: 'Intake Manifold Tuning (IMT) Valve Position Sensor/Switch Circuit Low',
  P2078: 'Intake Manifold Tuning (IMT) Valve Position Sensor/Switch Circuit High',
  P2079: 'Intake Manifold Tuning (IMT) Valve Position Sensor/Switch Circuit Intermittent',

  // Exhaust gas temperature sensor range/performance
  P2080: 'Exhaust Gas Temperature Sensor Circuit Range/Performance Bank 1 Sensor 1',
  P2081: 'Exhaust Gas Temperature Sensor Circuit Intermittent Bank 1 Sensor 1',
  P2082: 'Exhaust Gas Temperature Sensor Circuit Range/Performance Bank 2 Sensor 1',
  P2083: 'Exhaust Gas Temperature Sensor Circuit Intermittent Bank 2 Sensor 1',
  P2084: 'Exhaust Gas Temperature Sensor Circuit Range/Performance Bank 1 Sensor 2',
  P2085: 'Exhaust Gas Temperature Sensor Circuit Intermittent Bank 1 Sensor 2',
  P2086: 'Exhaust Gas Temperature Sensor Circuit Range/Performance Bank 2 Sensor 2',
  P2087: 'Exhaust Gas Temperature Sensor Circuit Intermittent Bank 2 Sensor 2',

  // Camshaft position actuator control circuits
  P2088: '"A" Camshaft Position Actuator Control Circuit Low Bank 1',
  P2089: '"A" Camshaft Position Actuator Control Circuit High Bank 1',
  P2090: '"B" Camshaft Position Actuator Control Circuit Low Bank 1',
  P2091: '"B" Camshaft Position Actuator Control Circuit High Bank 1',
  P2092: '"A" Camshaft Position Actuator Control Circuit Low Bank 2',
  P2093: '"A" Camshaft Position Actuator Control Circuit High Bank 2',
  P2094: '"B" Camshaft Position Actuator Control Circuit Low Bank 2',
  P2095: '"B" Camshaft Position Actuator Control Circuit High Bank 2',

  // Post-catalyst fuel trim
  P2096: 'Post Catalyst Fuel Trim System Too Lean Bank 1',
  P2097: 'Post Catalyst Fuel Trim System Too Rich Bank 1',
  P2098: 'Post Catalyst Fuel Trim System Too Lean Bank 2',
  P2099: 'Post Catalyst Fuel Trim System Too Rich Bank 2',

  // Throttle actuator control (electronic throttle)
  P2100: 'Throttle Actuator Control Motor Circuit/Open',
  P2101: 'Throttle Actuator Control Motor Circuit Range/Performance',
  P2102: 'Throttle Actuator Control Motor Circuit Low',
  P2103: 'Throttle Actuator Control Motor Circuit High',
  P2104: 'Throttle Actuator Control System - Forced Idle',
  P2105: 'Throttle Actuator Control System - Forced Engine Shutdown',
  P2106: 'Throttle Actuator Control System - Forced Limited Power',
  P2107: 'Throttle Actuator Control Module Processor',
  P2108: 'Throttle Actuator Control Module Performance',
  P2109: 'Throttle/Pedal Position Sensor A Minimum Stop Performance',
  P2110: 'Throttle Actuator Control System - Forced Limited RPM',
  P2111: 'Throttle Actuator Control System - Stuck Open',
  P2112: 'Throttle Actuator Control System - Stuck Closed',
  P2113: 'Throttle/Pedal Position Sensor B Minimum Stop Performance',
  P2114: 'Throttle/Pedal Position Sensor C Minimum Stop Performance',
  P2115: 'Throttle/Pedal Position Sensor D Minimum Stop Performance',
  P2116: 'Throttle/Pedal Position Sensor E Minimum Stop Performance',
  P2117: 'Throttle/Pedal Position Sensor F Minimum Stop Performance',
  P2118: 'Throttle Actuator Control Motor Current Range/Performance',
  P2119: 'Throttle Actuator Control Throttle Body Range/Performance',

  // Throttle/pedal position sensors D, E, F and correlations
  P2120: 'Throttle/Pedal Position Sensor/Switch D Circuit',
  P2121: 'Throttle/Pedal Position Sensor/Switch D Circuit Range/Performance',
  P2122: 'Throttle/Pedal Position Sensor/Switch D Circuit Low Input',
  P2123: 'Throttle/Pedal Position Sensor/Switch D Circuit High Input',
  P2124: 'Throttle/Pedal Position Sensor/Switch D Circuit Intermittent',
  P2125: 'Throttle/Pedal Position Sensor/Switch E Circuit',
  P2126: 'Throttle/Pedal Position Sensor/Switch E Circuit Range/Performance',
  P2127: 'Throttle/Pedal Position Sensor/Switch E Circuit Low Input',
  P2128: 'Throttle/Pedal Position Sensor/Switch E Circuit High Input',
  P2129: 'Throttle/Pedal Position Sensor/Switch E Circuit Intermittent',
  P2130: 'Throttle/Pedal Position Sensor/Switch F Circuit',
  P2131: 'Throttle/Pedal Position Sensor/Switch F Circuit Range/Performance',
  P2132: 'Throttle/Pedal Position Sensor/Switch F Circuit Low Input',
  P2133: 'Throttle/Pedal Position Sensor/Switch F Circuit High Input',
  P2134: 'Throttle/Pedal Position Sensor/Switch F Circuit Intermittent',
  P2135: 'Throttle/Pedal Position Sensor/Switch A/B Voltage Correlation',
  P2136: 'Throttle/Pedal Position Sensor/Switch A/C Voltage Correlation',
  P2137: 'Throttle/Pedal Position Sensor/Switch B/C Voltage Correlation',
  P2138: 'Throttle/Pedal Position Sensor/Switch D/E Voltage Correlation',
  P2139: 'Throttle/Pedal Position Sensor/Switch D/F Voltage Correlation',
  P2140: 'Throttle/Pedal Position Sensor/Switch E/F Voltage Correlation',

  // EGR throttle and vent control
  P2141: 'Exhaust Gas Recirculation Throttle Control Circuit Low',
  P2142: 'Exhaust Gas Recirculation Throttle Control Circuit High',
  P2143: 'Exhaust Gas Recirculation Vent Control Circuit/Open',
  P2144: 'Exhaust Gas Recirculation Vent Control Circuit Low',
  P2145: 'Exhaust Gas Recirculation Vent Control Circuit High',

  // Fuel injector group supply voltage
  P2146: 'Fuel Injector Group A Supply Voltage Circuit/Open',
  P2147: 'Fuel Injector Group A Supply Voltage Circuit Low',
  P2148: 'Fuel Injector Group A Supply Voltage Circuit High',
  P2149: 'Fuel Injector Group B Supply Voltage Circuit/Open',
  P2150: 'Fuel Injector Group B Supply Voltage Circuit Low',
  P2151: 'Fuel Injector Group B Supply Voltage Circuit High',
  P2152: 'Fuel Injector Group C Supply Voltage Circuit/Open',
  P2153: 'Fuel Injector Group C Supply Voltage Circuit Low',
  P2154: 'Fuel Injector Group C Supply Voltage Circuit High',
  P2155: 'Fuel Injector Group D Supply Voltage Circuit/Open',
  P2156: 'Fuel Injector Group D Supply Voltage Circuit Low',
  P2157: 'Fuel Injector Group D Supply Voltage Circuit High',

  // Vehicle speed sensor B
  P2158: 'Vehicle Speed Sensor B',
  P2159: 'Vehicle Speed Sensor B Range/Performance',
  P2160: 'Vehicle Speed Sensor B Circuit Low',
  P2161: 'Vehicle Speed Sensor B Intermittent/Erratic',
  P2162: 'Vehicle Speed Sensor A/B Correlation',

  // Throttle/pedal position maximum stop
  P2163: 'Throttle/Pedal Position Sensor A Maximum Stop Performance',
  P2164: 'Throttle/Pedal Position Sensor B Maximum Stop Performance',
  P2165: 'Throttle/Pedal Position Sensor C Maximum Stop Performance',
  P2166: 'Throttle/Pedal Position Sensor D Maximum Stop Performance',
  P2167: 'Throttle/Pedal Position Sensor E Maximum Stop Performance',
  P2168: 'Throttle/Pedal Position Sensor F Maximum Stop Performance',

  // Exhaust pressure regulator
  P2169: 'Exhaust Pressure Regulator Vent Solenoid Control Circuit/Open',
  P2170: 'Exhaust Pressure Regulator Vent Solenoid Control Circuit Low',
  P2171: 'Exhaust Pressure Regulator Vent Solenoid Control Circuit High',

  // Throttle actuator control airflow / idle learn
  P2172: 'Throttle Actuator Control System - Sudden High Airflow Detected',
  P2173: 'Throttle Actuator Control System - High Airflow Detected',
  P2174: 'Throttle Actuator Control System - Sudden Low Airflow Detected',
  P2175: 'Throttle Actuator Control System - Low Airflow Detected',
  P2176: 'Throttle Actuator Control System - Idle Position Not Learned',

  // Fuel trim off idle
  P2177: 'System Too Lean Off Idle Bank 1',
  P2178: 'System Too Rich Off Idle Bank 1',
  P2179: 'System Too Lean Off Idle Bank 2',
  P2180: 'System Too Rich Off Idle Bank 2',

  // Cooling system / engine coolant temperature sensor 2
  P2181: 'Cooling System Performance',
  P2182: 'Engine Coolant Temperature Sensor 2 Circuit',
  P2183: 'Engine Coolant Temperature Sensor 2 Circuit Range/Performance',
  P2184: 'Engine Coolant Temperature Sensor 2 Circuit Low',
  P2185: 'Engine Coolant Temperature Sensor 2 Circuit High',
  P2186: 'Engine Coolant Temperature Sensor 2 Circuit Intermittent/Erratic',

  // Fuel trim at idle / higher load
  P2187: 'System Too Lean at Idle Bank 1',
  P2188: 'System Too Rich at Idle Bank 1',
  P2189: 'System Too Lean at Idle Bank 2',
  P2190: 'System Too Rich at Idle Bank 2',
  P2191: 'System Too Lean at Higher Load Bank 1',
  P2192: 'System Too Rich at Higher Load Bank 1',
  P2193: 'System Too Lean at Higher Load Bank 2',
  P2194: 'System Too Rich at Higher Load Bank 2',

  // O2 sensor stuck lean/rich (sensor 1), IAT correlation
  P2195: 'O2 Sensor Signal Stuck Lean Bank 1 Sensor 1',
  P2196: 'O2 Sensor Signal Stuck Rich Bank 1 Sensor 1',
  P2197: 'O2 Sensor Signal Stuck Lean Bank 2 Sensor 1',
  P2198: 'O2 Sensor Signal Stuck Rich Bank 2 Sensor 1',
  P2199: 'Intake Air Temperature Sensor 1/2 Correlation',

  // NOx sensors
  P2200: 'NOx Sensor Circuit Bank 1',
  P2201: 'NOx Sensor Circuit Range/Performance Bank 1',
  P2202: 'NOx Sensor Circuit Low Input Bank 1',
  P2203: 'NOx Sensor Circuit High Input Bank 1',
  P2204: 'NOx Sensor Circuit Intermittent Input Bank 1',
  P2205: 'NOx Sensor Heater Control Circuit/Open Bank 1',
  P2206: 'NOx Sensor Heater Control Circuit Low Bank 1',
  P2207: 'NOx Sensor Heater Control Circuit High Bank 1',
  P2208: 'NOx Sensor Heater Sense Circuit Bank 1',
  P2209: 'NOx Sensor Heater Sense Circuit Range/Performance Bank 1',
  P2210: 'NOx Sensor Heater Sense Circuit Low Input Bank 1',
  P2211: 'NOx Sensor Heater Sense Circuit High Input Bank 1',
  P2212: 'NOx Sensor Heater Sense Circuit Intermittent Bank 1',
  P2213: 'NOx Sensor Circuit Bank 2',
  P2214: 'NOx Sensor Circuit Range/Performance Bank 2',
  P2215: 'NOx Sensor Circuit Low Input Bank 2',
  P2216: 'NOx Sensor Circuit High Input Bank 2',
  P2217: 'NOx Sensor Circuit Intermittent Input Bank 2',
  P2218: 'NOx Sensor Heater Control Circuit/Open Bank 2',
  P2219: 'NOx Sensor Heater Control Circuit Low Bank 2',
  P2220: 'NOx Sensor Heater Control Circuit High Bank 2',
  P2221: 'NOx Sensor Heater Sense Circuit Bank 2',
  P2222: 'NOx Sensor Heater Sense Circuit Range/Performance Bank 2',
  P2223: 'NOx Sensor Heater Sense Circuit Low Input Bank 2',
  P2224: 'NOx Sensor Heater Sense Circuit High Input Bank 2',
  P2225: 'NOx Sensor Heater Sense Circuit Intermittent Bank 2',

  // Barometric pressure sensor
  P2226: 'Barometric Pressure Circuit',
  P2227: 'Barometric Pressure Circuit Range/Performance',
  P2228: 'Barometric Pressure Circuit Low',
  P2229: 'Barometric Pressure Circuit High',
  P2230: 'Barometric Pressure Circuit Intermittent',

  // O2 sensor circuit faults (heater short, wide-band pump/reference circuits)
  P2231: 'O2 Sensor Signal Circuit Shorted to Heater Circuit Bank 1 Sensor 1',
  P2232: 'O2 Sensor Signal Circuit Shorted to Heater Circuit Bank 1 Sensor 2',
  P2233: 'O2 Sensor Signal Circuit Shorted to Heater Circuit Bank 1 Sensor 3',
  P2234: 'O2 Sensor Signal Circuit Shorted to Heater Circuit Bank 2 Sensor 1',
  P2235: 'O2 Sensor Signal Circuit Shorted to Heater Circuit Bank 2 Sensor 2',
  P2236: 'O2 Sensor Signal Circuit Shorted to Heater Circuit Bank 2 Sensor 3',
  P2237: 'O2 Sensor Positive Current Control Circuit/Open Bank 1 Sensor 1',
  P2238: 'O2 Sensor Positive Current Control Circuit Low Bank 1 Sensor 1',
  P2239: 'O2 Sensor Positive Current Control Circuit High Bank 1 Sensor 1',
  P2240: 'O2 Sensor Positive Current Control Circuit/Open Bank 2 Sensor 1',
  P2241: 'O2 Sensor Positive Current Control Circuit Low Bank 2 Sensor 1',
  P2242: 'O2 Sensor Positive Current Control Circuit High Bank 2 Sensor 1',
  P2243: 'O2 Sensor Reference Voltage Circuit/Open Bank 1 Sensor 1',
  P2244: 'O2 Sensor Reference Voltage Performance Bank 1 Sensor 1',
  P2245: 'O2 Sensor Reference Voltage Circuit Low Bank 1 Sensor 1',
  P2246: 'O2 Sensor Reference Voltage Circuit High Bank 1 Sensor 1',
  P2247: 'O2 Sensor Reference Voltage Circuit/Open Bank 2 Sensor 1',
  P2248: 'O2 Sensor Reference Voltage Performance Bank 2 Sensor 1',
  P2249: 'O2 Sensor Reference Voltage Circuit Low Bank 2 Sensor 1',
  P2250: 'O2 Sensor Reference Voltage Circuit High Bank 2 Sensor 1',
  P2251: 'O2 Sensor Negative Current Control Circuit/Open Bank 1 Sensor 1',
  P2252: 'O2 Sensor Negative Current Control Circuit Low Bank 1 Sensor 1',
  P2253: 'O2 Sensor Negative Current Control Circuit High Bank 1 Sensor 1',
  P2254: 'O2 Sensor Negative Current Control Circuit/Open Bank 2 Sensor 1',
  P2255: 'O2 Sensor Negative Current Control Circuit Low Bank 2 Sensor 1',
  P2256: 'O2 Sensor Negative Current Control Circuit High Bank 2 Sensor 1',

  // Secondary air injection control circuits
  P2257: 'Secondary Air Injection System Control "A" Circuit Low',
  P2258: 'Secondary Air Injection System Control "A" Circuit High',
  P2259: 'Secondary Air Injection System Control "B" Circuit Low',
  P2260: 'Secondary Air Injection System Control "B" Circuit High',

  // Turbocharger / supercharger
  P2261: 'Turbo/Super Charger Bypass Valve - Mechanical',
  P2262: 'Turbo/Super Charger Boost Pressure Not Detected - Mechanical',
  P2263: 'Turbo/Super Charger Boost System Performance',

  // Water in fuel
  P2264: 'Water in Fuel Sensor Circuit',
  P2265: 'Water in Fuel Sensor Circuit Range/Performance',
  P2266: 'Water in Fuel Sensor Circuit Low',
  P2267: 'Water in Fuel Sensor Circuit High',
  P2268: 'Water in Fuel Sensor Circuit Intermittent',
  P2269: 'Water in Fuel Condition',

  // O2 sensor stuck lean/rich (sensors 2 and 3), signals swapped
  P2270: 'O2 Sensor Signal Stuck Lean Bank 1 Sensor 2',
  P2271: 'O2 Sensor Signal Stuck Rich Bank 1 Sensor 2',
  P2272: 'O2 Sensor Signal Stuck Lean Bank 2 Sensor 2',
  P2273: 'O2 Sensor Signal Stuck Rich Bank 2 Sensor 2',
  P2274: 'O2 Sensor Signal Stuck Lean Bank 1 Sensor 3',
  P2275: 'O2 Sensor Signal Stuck Rich Bank 1 Sensor 3',
  P2276: 'O2 Sensor Signal Stuck Lean Bank 2 Sensor 3',
  P2277: 'O2 Sensor Signal Stuck Rich Bank 2 Sensor 3',
  P2278: 'O2 Sensor Signals Swapped Bank 1 Sensor 3 / Bank 2 Sensor 3',

  // Intake air leaks
  P2279: 'Intake Air System Leak',
  P2280: 'Air Flow Restriction / Air Leak Between Air Filter and MAF',
  P2281: 'Air Leak Between MAF and Throttle Body',
  P2282: 'Air Leak Between Throttle Body and Intake Valves',

  // Injector control pressure (HEUI diesel)
  P2283: 'Injector Control Pressure Sensor Circuit',
  P2284: 'Injector Control Pressure Sensor Circuit Range/Performance',
  P2285: 'Injector Control Pressure Sensor Circuit Low',
  P2286: 'Injector Control Pressure Sensor Circuit High',
  P2287: 'Injector Control Pressure Sensor Circuit Intermittent',
  P2288: 'Injector Control Pressure Too High',
  P2289: 'Injector Control Pressure Too High - Engine Off',
  P2290: 'Injector Control Pressure Too Low',
  P2291: 'Injector Control Pressure Too Low - Engine Cranking',
  P2292: 'Injector Control Pressure Erratic',

  // Fuel pressure regulator 2
  P2293: 'Fuel Pressure Regulator 2 Performance',
  P2294: 'Fuel Pressure Regulator 2 Control Circuit',
  P2295: 'Fuel Pressure Regulator 2 Control Circuit Low',
  P2296: 'Fuel Pressure Regulator 2 Control Circuit High',

  // O2 sensor deceleration, brake/accelerator plausibility
  P2297: 'O2 Sensor Out of Range During Deceleration Bank 1 Sensor 1',
  P2298: 'O2 Sensor Out of Range During Deceleration Bank 2 Sensor 1',
  P2299: 'Brake Pedal Position / Accelerator Pedal Position Incompatible',

  // Ignition coils A-L
  P2300: 'Ignition Coil A Primary Control Circuit Low',
  P2301: 'Ignition Coil A Primary Control Circuit High',
  P2302: 'Ignition Coil A Secondary Circuit',
  P2303: 'Ignition Coil B Primary Control Circuit Low',
  P2304: 'Ignition Coil B Primary Control Circuit High',
  P2305: 'Ignition Coil B Secondary Circuit',
  P2306: 'Ignition Coil C Primary Control Circuit Low',
  P2307: 'Ignition Coil C Primary Control Circuit High',
  P2308: 'Ignition Coil C Secondary Circuit',
  P2309: 'Ignition Coil D Primary Control Circuit Low',
  P2310: 'Ignition Coil D Primary Control Circuit High',
  P2311: 'Ignition Coil D Secondary Circuit',
  P2312: 'Ignition Coil E Primary Control Circuit Low',
  P2313: 'Ignition Coil E Primary Control Circuit High',
  P2314: 'Ignition Coil E Secondary Circuit',
  P2315: 'Ignition Coil F Primary Control Circuit Low',
  P2316: 'Ignition Coil F Primary Control Circuit High',
  P2317: 'Ignition Coil F Secondary Circuit',
  P2318: 'Ignition Coil G Primary Control Circuit Low',
  P2319: 'Ignition Coil G Primary Control Circuit High',
  P2320: 'Ignition Coil G Secondary Circuit',
  P2321: 'Ignition Coil H Primary Control Circuit Low',
  P2322: 'Ignition Coil H Primary Control Circuit High',
  P2323: 'Ignition Coil H Secondary Circuit',
  P2324: 'Ignition Coil I Primary Control Circuit Low',
  P2325: 'Ignition Coil I Primary Control Circuit High',
  P2326: 'Ignition Coil I Secondary Circuit',
  P2327: 'Ignition Coil J Primary Control Circuit Low',
  P2328: 'Ignition Coil J Primary Control Circuit High',
  P2329: 'Ignition Coil J Secondary Circuit',
  P2330: 'Ignition Coil K Primary Control Circuit Low',
  P2331: 'Ignition Coil K Primary Control Circuit High',
  P2332: 'Ignition Coil K Secondary Circuit',
  P2333: 'Ignition Coil L Primary Control Circuit Low',
  P2334: 'Ignition Coil L Primary Control Circuit High',
  P2335: 'Ignition Coil L Secondary Circuit',

  // Knock per cylinder
  P2336: 'Cylinder 1 Above Knock Threshold',
  P2337: 'Cylinder 2 Above Knock Threshold',
  P2338: 'Cylinder 3 Above Knock Threshold',
  P2339: 'Cylinder 4 Above Knock Threshold',
  P2340: 'Cylinder 5 Above Knock Threshold',
  P2341: 'Cylinder 6 Above Knock Threshold',
  P2342: 'Cylinder 7 Above Knock Threshold',
  P2343: 'Cylinder 8 Above Knock Threshold',
  P2344: 'Cylinder 9 Above Knock Threshold',
  P2345: 'Cylinder 10 Above Knock Threshold',
  P2346: 'Cylinder 11 Above Knock Threshold',
  P2347: 'Cylinder 12 Above Knock Threshold',

  // EVAP leak detection pump
  P2400: 'Evaporative Emission System Leak Detection Pump Control Circuit/Open',
  P2401: 'Evaporative Emission System Leak Detection Pump Control Circuit Low',
  P2402: 'Evaporative Emission System Leak Detection Pump Control Circuit High',
  P2403: 'Evaporative Emission System Leak Detection Pump Sense Circuit/Open',
  P2404: 'Evaporative Emission System Leak Detection Pump Sense Circuit Range/Performance',
  P2405: 'Evaporative Emission System Leak Detection Pump Sense Circuit Low',
  P2406: 'Evaporative Emission System Leak Detection Pump Sense Circuit High',
  P2407: 'Evaporative Emission System Leak Detection Pump Sense Circuit Intermittent/Erratic',

  // Fuel cap sensor
  P2408: 'Fuel Cap Sensor/Switch Circuit',
  P2409: 'Fuel Cap Sensor/Switch Circuit Range/Performance',
  P2410: 'Fuel Cap Sensor/Switch Circuit Low',
  P2411: 'Fuel Cap Sensor/Switch Circuit High',
  P2412: 'Fuel Cap Sensor/Switch Circuit Intermittent/Erratic',

  // EGR performance, O2 sample error / signals swapped
  P2413: 'Exhaust Gas Recirculation System Performance',
  P2414: 'O2 Sensor Exhaust Sample Error Bank 1 Sensor 1',
  P2415: 'O2 Sensor Exhaust Sample Error Bank 2 Sensor 1',
  P2416: 'O2 Sensor Signals Swapped Bank 1 Sensor 2 / Bank 1 Sensor 3',
  P2417: 'O2 Sensor Signals Swapped Bank 2 Sensor 2 / Bank 2 Sensor 3',

  // EVAP switching / vent valve
  P2418: 'Evaporative Emission System Switching Valve Control Circuit/Open',
  P2419: 'Evaporative Emission System Switching Valve Control Circuit Low',
  P2420: 'Evaporative Emission System Switching Valve Control Circuit High',
  P2421: 'Evaporative Emission System Vent Valve Stuck Open',
  P2422: 'Evaporative Emission System Vent Valve Stuck Closed',

  // HC adsorption catalyst
  P2423: 'HC Adsorption Catalyst Efficiency Below Threshold Bank 1',
  P2424: 'HC Adsorption Catalyst Efficiency Below Threshold Bank 2',

  // EGR cooling valve, exhaust gas temperature too high
  P2425: 'Exhaust Gas Recirculation Cooling Valve Control Circuit/Open',
  P2426: 'Exhaust Gas Recirculation Cooling Valve Control Circuit Low',
  P2427: 'Exhaust Gas Recirculation Cooling Valve Control Circuit High',
  P2428: 'Exhaust Gas Temperature Too High Bank 1',
  P2429: 'Exhaust Gas Temperature Too High Bank 2',

  // Diesel particulate filter restriction (ash)
  P242F: 'Diesel Particulate Filter Restriction - Ash Accumulation',

  // Secondary air injection flow/pressure sensor, valves and pump
  P2430: 'Secondary Air Injection System Air Flow/Pressure Sensor Circuit Bank 1',
  P2431: 'Secondary Air Injection System Air Flow/Pressure Sensor Circuit Range/Performance Bank 1',
  P2432: 'Secondary Air Injection System Air Flow/Pressure Sensor Circuit Low Bank 1',
  P2433: 'Secondary Air Injection System Air Flow/Pressure Sensor Circuit High Bank 1',
  P2434:
    'Secondary Air Injection System Air Flow/Pressure Sensor Circuit Intermittent/Erratic Bank 1',
  P2435: 'Secondary Air Injection System Air Flow/Pressure Sensor Circuit Bank 2',
  P2436: 'Secondary Air Injection System Air Flow/Pressure Sensor Circuit Range/Performance Bank 2',
  P2437: 'Secondary Air Injection System Air Flow/Pressure Sensor Circuit Low Bank 2',
  P2438: 'Secondary Air Injection System Air Flow/Pressure Sensor Circuit High Bank 2',
  P2439:
    'Secondary Air Injection System Air Flow/Pressure Sensor Circuit Intermittent/Erratic Bank 2',
  P2440: 'Secondary Air Injection System Switching Valve Stuck Open Bank 1',
  P2441: 'Secondary Air Injection System Switching Valve Stuck Closed Bank 1',
  P2442: 'Secondary Air Injection System Switching Valve Stuck Open Bank 2',
  P2443: 'Secondary Air Injection System Switching Valve Stuck Closed Bank 2',
  P2444: 'Secondary Air Injection System Pump Stuck On Bank 1',
  P2445: 'Secondary Air Injection System Pump Stuck Off Bank 1',
  P2446: 'Secondary Air Injection System Pump Stuck On Bank 2',
  P2447: 'Secondary Air Injection System Pump Stuck Off Bank 2',

  // Diesel particulate filter pressure sensor and regeneration, EGR cooling
  P2452: 'Diesel Particulate Filter Pressure Sensor A Circuit',
  P2453: 'Diesel Particulate Filter Pressure Sensor A Circuit Range/Performance',
  P2454: 'Diesel Particulate Filter Pressure Sensor A Circuit Low',
  P2455: 'Diesel Particulate Filter Pressure Sensor A Circuit High',
  P2456: 'Diesel Particulate Filter Pressure Sensor A Circuit Intermittent/Erratic',
  P2457: 'Exhaust Gas Recirculation Cooling System Performance',
  P2458: 'Diesel Particulate Filter Regeneration Duration',
  P2459: 'Diesel Particulate Filter Regeneration Frequency',
  P2463: 'Diesel Particulate Filter Restriction - Soot Accumulation',
};
