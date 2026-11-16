export const PHOTO_SRC: Record<string, string> = {
  facet: '1588440691140-09155c1be58a', ivory: '1545239705-1564e58b9e4a', terracotta: '1616856762053-425b01f896cc', sunset: '1762755647813-017e128a4ba0',
  blush: '1730818705543-db44a62fd4f7', bowl: '1567934596102-dd6655aedff9',
  canyon: '1531168556467-80aace0d0144', highlands: '1546507318-dc206ad061c9', kirkjufell: '1544638627-725124bda50d', blacksand: '1685443866545-57adcff6e0be',
  moonhouse: '1660050186491-cbd9d8e02d2d', pagoda: '1624253321171-1be53e12f5f4', gion: '1602764396732-ec594dacd87a', sakura: '1649216002827-6bd666850ebf',
  coast: '1594365458706-6fab3472f681', seacliff: '1574880721693-1cd607664618', headland: '1571243827682-305f9c83051b', bluffs: '1704779142583-e8a4a25bef67',
  neonstreet: '1541702467897-41915a07d3a7', timessq: '1551726742-e7fef3db157e', alley: '1560253740-f0e82b766d72', louise: '1439853949127-fa647821eba0',
  mirror: '1464852045489-bccb7d17fe39', mist: '1506536329413-d2f0d31ceb9f', moraine: '1542854644-5de6b6c8b09c', seceda: '1615729947596-a598e5de0ab3',
  tulips: '1600418692921-18c91a64baa8', poppies: '1543862475-eb136770ae9b', sunflowers: '1598920710727-e6c74781538c', meadow: '1523437237164-d442d57cc3c9',
  'glass-wide': '1554147090-e1221a04a025', container: '1474540412665-1cdae210ae6b',
  orb: '1604079628040-94301bb21b91', tide: '1669295384050-a1d4357bd1d7', bloom: '1604076913837-52ab5629fba9', drift: '1620641788421-7a1c342ea42e',
  deep: '1620121692029-d088224ddc74', ember: '1618005182384-a83a8bd57fbe', moons: '1618005198919-d3d4b5a92ead', prism: '1573655349936-de6bed86f839',
};
export const photoURL = (name: string) => `/site/photos/${name}.jpg`;
export const thumbURL = (name: string) => `/site/photos/thumbs/${name}.jpg`;
