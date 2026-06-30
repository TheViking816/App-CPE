const CENSO_RAW = `
2699 2700 2701 2708 2702 2703 2704 2705 2706 2707 2717 2712 2714 2715 2719 2730 2720 2721 2722 2723 2725 2728 2729 2733 2739 2741 2743 2149 2140 2583 2640 2641 2742 2658 2718
2713 2737 2736 1621 2636 2615 1045 2642 2624 2645 2647 2648 2649 2643 2644 2668 2655 2683 2711 2710 2724 2682 2657 1568 2709 2685 2548 2585 2599 2605 2597 2555 2550 2562 2563
2569 2627 2571 2500 2510 2586 2502 2623 2503 2602 2543 2524 1593 2514 2508 2565 2549 2618 2504 2511 2512 2561 2513 1574 2521 2526 2528 1057 2529 2533 2531 1294 2539 1050 2540
1890 2566 1628 2541 1122 1121 1133 1060 1288 1526 1762 1807 1874 1289 2325 1431 1274 1139 1140 1752 1548 1306 1053 2354 2306 1964 2264 2346 2266 1429 1178 1350 1455 1657 1720
1074 1643 1553 1895 1531 2124 1856 1897 1613 1406 1682 1600 1492 1822 1651 1374 1345 1496 1580 1846 1322 1814 1302 1875 1675 1452 1842 1868 1446 1550 1640 1612 1882 1283 1335
1143 1862 1286 1400 1572 1480 1597 1487 1719 1391 1476 1727 1601 1634 1726 1765 1614 1707 1754 1579 1771 1801 1911 1772 1773 1789 1755 1337 1295 1970 1475 1131 1186 1285 1396
1686 1980 1671 1015 1005 1591 1918 1422 1513 1357 2281 1161 1362 1011 1829 1841 1997 1073 1510 1004 1945 1904 1021 1034 1055 1052 1898 1019 1565 1164 1058 1030 1066 1409 1407
1068 1089 1965 1270 1109 1102 1972 1091 1439 1163 2163 1188 1826 1147 1244 1071 1104 1204 1920 1112 1354 1784 1769 1130 1847 1681 1016 1537 1471 1414 1716 2334 1974 1272 1101
1991 1891 1913 1387 1990 1300 1806 1885 1884 2059 1427 1821 1715 1589 1959 1382 1626 2090 1518 1939 1932 1665 1967 1984 1714 1848 1701 1654 1450 1202 1236 1325 2119 1469 1803
2300 2268 2064 2660 2115 2065 2069 2094 2331 2095 1238 1240 1903 1061 1241 1167 1205 1850 1853 1404 2053 2047 1278 1963 2008 2017 1519 1647 1931 1338 1567 2025 2026 2297 2030
2032 2056 2045 2018 2024 2048 1927 2007 2036 2051 2279 2060 2055 1893 2072 2058 2066 2078 2272 2083 2160 2086 2132 2274 2080 2201 2015 2603 2552 2611 2613 2622 1486 2646 2614
2617 2625 2590 2628 2629 2630 2631 1658 2022 2099 1660 2101 2120 2147 2033 2100 2104 1485 2107 2111 2131 2133 2134 2142 2136 2139 2084 2143 2103 2145 2151 2161 2093 1263 2157
2326 1625 2162 1923 1258 1942 2097 2110 2114 2591 2664 2727 2592 2280 2286 1304 2206 2244 2237 1039 1040 1100 1955 1851 2301 2339 1947 2148 2356 2288 2310 2226 2150 2220 2259
2222 2342 2040 2228 2245 2296 2261 2353 2223 1031 2265 1924 2267 2235 2253 2251 2263 2293 2292 2283 2043 2035 1438 1551 2041 2122 2333 2241 2596 2313 2282 2240 2246 2344 1181
1412 2347 2332 2273 2262 2305 2276 2329 2337 2311 2277 2519 1237 2545 2669 2626 2294 2328 2284 2322 1996 2304 2295 2338 2340 1629 2350 2355 1881 1751 1220 1695 2275 1080 2316
2141 1277 2662 2676 2665 2666 2667 2673 2670 2671 2653 2661 2681 2604 2601 2686 2659 2687 2656 2654 2688 2726 2716 2732 2740 2689 2690 2675 1569 2691 2652 2616 2515 1478 1149
2696 2697 2698 2650 2695 2679 2680 2619 2692 1013 2672 2731 2744
`;

export const specialty = {
  id: "conductor-1a",
  name: "CONDUCTOR 1a",
  expectedSize: 573,
  doors: [
    { key: "LAB", label: "Diurna", raw: 72625, dayType: "laborable", shift: "LAB" },
    { key: "NOC", label: "Super", raw: 72699, dayType: "laborable", shift: "NOC" },
    { key: "NOC-FES", label: "Super festiva", raw: 72737, dayType: "festivo", shift: "NOC-FES" },
    { key: "FES", label: "Diurna festiva", raw: 72541, dayType: "festivo", shift: "FES" }
  ]
};

export const censo = CENSO_RAW.trim()
  .split(/\s+/)
  .map((value, index) => ({
    chapa: Number(value),
    position: index + 1
  }));

export function normalizeDoor(rawDoor) {
  const text = String(rawDoor || "").trim();
  if (text.length <= 4) return Number(text);
  return Number(text.slice(-4));
}

export function findByChapa(chapa) {
  const numeric = Number(chapa);
  if (!Number.isFinite(numeric)) return null;
  return censo.find((item) => item.chapa === numeric) || null;
}

export function distanceForward(fromPosition, toPosition, size = censo.length) {
  if (!fromPosition || !toPosition) return null;
  if (toPosition >= fromPosition) return toPosition - fromPosition;
  return size - fromPosition + toPosition;
}

export function getDoorState(userChapa, doors = specialty.doors) {
  const user = findByChapa(userChapa);

  return doors.map((door) => {
    const doorChapa = normalizeDoor(door.raw);
    const doorWorker = findByChapa(doorChapa);
    const distance = user && doorWorker
      ? distanceForward(doorWorker.position, user.position)
      : null;

    return {
      ...door,
      doorChapa,
      doorPosition: doorWorker?.position || null,
      userPosition: user?.position || null,
      distance
    };
  });
}

export function classifyDistance(distance) {
  if (distance === null) return "muted";
  if (distance === 0) return "now";
  if (distance <= 20) return "near";
  if (distance <= 80) return "medium";
  return "far";
}

export function validateCenso() {
  const seen = new Set();
  const duplicates = [];
  for (const item of censo) {
    if (seen.has(item.chapa)) duplicates.push(item.chapa);
    seen.add(item.chapa);
  }

  return {
    count: censo.length,
    expected: specialty.expectedSize,
    ok: censo.length === specialty.expectedSize && duplicates.length === 0,
    duplicates
  };
}
