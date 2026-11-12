// Written by scripts/build.py from sites/gregory/site.json and features.json. Edit those, not this file.
window.GA_CONFIG = {
 "key": "gregory",
 "storageKey": "ga",
 "siteTitle": "Gregory Archive",
 "pageTitle": "Gregory Archive — Slide Collection",
 "description": "Browse, search and visualize the Timothy E. Gregory slide archive: 31,000+ photographs of Greece, Byzantium and the Mediterranean.",
 "brand": {
  "mark": "Γ",
  "sub": "Slide Collection"
 },
 "theme": {
  "accent": "#9a4f24",
  "accentInk": "#7a3c18",
  "accentSoft": "#f3e6dc"
 },
 "storyUrl": "https://gregoryarchive.org",
 "storyLabel": "The story ↗",
 "searchPlaceholder": "Search titles, subjects, places, boxes…",
 "exportName": "gregory-archive",
 "noun": {
  "one": "image",
  "many": "images"
 },
 "dataUrl": "data/archive.json",
 "imageBase": "https://gregoryslides.s3.amazonaws.com/",
 "thumbBase": "https://gregoryslides.s3.amazonaws.com/thumbs/400/",
 "mediumBase": "https://gregoryslides.s3.amazonaws.com/thumbs/1600/",
 "thumbsReady": false,
 "appsScriptUrl": "",
 "permalinkBase": "https://tregodan-msu.github.io/gregoryarchive/",
 "permalinkPath": "slide",
 "boxPhotoBase": "https://gregoryslides.s3.amazonaws.com/boxes/",
 "boxCovers": {},
 "fields": {
  "id": "ID",
  "title": "Title",
  "titleFallback": [
   "Subject",
   "Digital File Name"
  ],
  "caption": [
   "Location",
   "_cy"
  ],
  "boardCaption": [
   "Subject",
   "Location"
  ],
  "location": "Location",
  "geo": "Georeference",
  "images": [
   {
    "field": "Digital File Name",
    "urlField": "Image_URL"
   }
  ],
  "date": {
   "field": "Date of Subject",
   "label": "Date of subject",
   "year": "Subject date (year)",
   "century": "Century (subject)"
  },
  "created": {
   "field": "Date Created",
   "label": "Year photographed",
   "decade": "Decade photographed"
  }
 },
 "labels": {},
 "views": [
  "gallery",
  "boxes",
  "table",
  "map",
  "charts"
 ],
 "group": {
  "field": "Slide Box",
  "nav": "Slide Boxes",
  "tab": "Boxes",
  "plural": "boxes",
  "items": [
   "slide",
   "slides"
  ],
  "numbered": true,
  "photos": true,
  "hint": "Open a box to see its slides.",
  "map": false
 },
 "groupable": [
  "Slide Box",
  "Location",
  "Subject",
  "Creator",
  "Century (subject)",
  "Decade photographed",
  "Digitizer 1",
  "Medium",
  "Format",
  "Has map location"
 ],
 "keyFields": [
  "Title",
  "Subject",
  "Location",
  "Date of Subject",
  "Date Created",
  "Slide Box",
  "Creator"
 ],
 "facetFields": [
  "Slide Box",
  "Location",
  "Subject",
  "Creator",
  "Digitizer 1",
  "Digitizer 2",
  "Medium",
  "Format",
  "Class",
  "Device",
  "Date digitized"
 ],
 "linkFields": [
  "Location",
  "Subject"
 ],
 "sorts": [
  [
   "box",
   "Slide box order"
  ],
  [
   "title",
   "Title A–Z"
  ],
  [
   "subjOld",
   "Subject date, oldest"
  ],
  [
   "subjNew",
   "Subject date, newest"
  ],
  [
   "photoOld",
   "Photographed, oldest"
  ],
  [
   "photoNew",
   "Photographed, newest"
  ],
  [
   "loc",
   "Location A–Z"
  ]
 ],
 "table": {
  "cols": [
   "ID",
   "Title",
   "Subject",
   "Location",
   "Date of Subject",
   "Date Created",
   "Slide Box",
   "Creator",
   "Digital File Name",
   "URI"
  ],
  "widths": {
   "Title": 230,
   "Subject": 170,
   "Location": 140,
   "Date of Subject": 120,
   "Date Created": 110,
   "Slide Box": 200,
   "Creator": 140,
   "Digital File Name": 160
  }
 },
 "numeric": [],
 "charts": {
  "defaultX": "Location",
  "stackSeries": [
   "Medium",
   "Creator"
  ],
  "defaults": [
   0,
   1,
   2
  ],
  "suggestions": [
   {
    "title": "Images by location",
    "type": "bar",
    "x": "Location",
    "top": 15,
    "note": "Where the photographs were taken"
   },
   {
    "title": "Subjects across time",
    "type": "column",
    "x": "Subject date (year)",
    "bin": 100,
    "note": "Century of the thing photographed"
   },
   {
    "title": "Share by medium",
    "type": "pie",
    "x": "Medium",
    "note": "Colour vs black-and-white, positive vs negative"
   },
   {
    "title": "Photographs per year",
    "type": "line",
    "x": "Year photographed",
    "bin": 1,
    "note": "When the slides were shot"
   },
   {
    "title": "Photographs per year by creator",
    "type": "line",
    "x": "Year photographed",
    "bin": 1,
    "series": "Creator",
    "note": "Several lines, one per photographer"
   },
   {
    "title": "Top locations by century",
    "type": "stacked",
    "x": "Location",
    "top": 10,
    "series": "Century (subject)",
    "note": "Stacked columns"
   },
   {
    "title": "Subject date vs year photographed",
    "type": "scatter",
    "x": "Year photographed",
    "yField": "Subject date (year)",
    "series": "Creator",
    "note": "Each dot is one slide; drag to select"
   },
   {
    "title": "Slide boxes by size",
    "type": "bar",
    "x": "Slide Box",
    "top": 20,
    "sort": "value",
    "note": "Largest boxes first"
   },
   {
    "title": "Who digitized the slides",
    "type": "donut",
    "x": "Digitizer 1",
    "note": "Donut with total"
   },
   {
    "title": "Distinct locations per box",
    "type": "bar",
    "x": "Slide Box",
    "top": 20,
    "y": "distinct",
    "yField": "Location",
    "note": "How varied each box is"
   },
   {
    "title": "Average subject date by location",
    "type": "bar",
    "x": "Location",
    "top": 15,
    "y": "avg",
    "yField": "Subject date (year)",
    "note": "Older sites vs newer"
   },
   {
    "title": "Photographs per 5 years by location",
    "type": "area",
    "x": "Year photographed",
    "bin": 5,
    "series": "Location",
    "note": "Stacked area, top 7 locations"
   },
   {
    "title": "Map coverage",
    "type": "donut",
    "x": "Has map location",
    "note": "Slides with and without coordinates"
   },
   {
    "title": "Subjects by century and medium",
    "type": "grouped",
    "x": "Subject date (year)",
    "bin": 100,
    "series": "Medium",
    "note": "Grouped columns"
   }
  ]
 },
 "editor": {
  "defaultCols": [
   "Title",
   "Subject",
   "Location",
   "Georeference",
   "Date of Subject",
   "Date Created",
   "Slide Box",
   "Creator",
   "Digital File Name",
   "Digitizer 1",
   "Digitizer 2",
   "Date digitized",
   "Device",
   "Medium",
   "Format",
   "Class"
  ],
  "widths": {
   "Title": 240,
   "Subject": 200,
   "Location": 150,
   "Georeference": 170,
   "Date of Subject": 130,
   "Date Created": 110,
   "Slide Box": 200,
   "Creator": 150,
   "Digital File Name": 170,
   "Image_URL": 260
  },
  "categorical": [
   "Slide Box",
   "Location",
   "Subject",
   "Creator",
   "Digitizer 1",
   "Digitizer 2",
   "Device",
   "Medium",
   "Format",
   "Class",
   "Date digitized",
   "Date of Subject"
  ],
  "textarea": [
   "Title",
   "Subject"
  ],
  "issues": [
   "missing:Title",
   "missing:Subject",
   "missing:Location",
   "missing:Date Created",
   "no-geo",
   "bad-geo",
   "dup-file",
   "shifted",
   "header-row",
   "no-image"
  ],
  "shiftRepair": true,
  "upload": {
   "fields": [
    "Slide Box",
    "Location",
    "Subject",
    "Date Created",
    "Creator",
    "Digitizer 1",
    "Medium",
    "Format",
    "Class"
   ],
   "defaults": {
    "Medium": "Color Positive",
    "Format": "35mm",
    "Class": "Image"
   }
  }
 },
 "hub": {
  "type": "Photograph",
  "area": "",
  "trench": "",
  "people": "",
  "year": "",
  "search": [
   "Title",
   "Subject",
   "Slide Box"
  ],
  "only": "isthmia|ισθμια",
  "onlyFields": [
   "Location"
  ],
  "cut": false
 },
 "viewer": {
  "background": "dark"
 },
 "features": {
  "gallery": true,
  "boxes": true,
  "table": true,
  "charts": true,
  "map": "view",
  "sitePhoto": true,
  "background": "dark",
  "cardPair": false,
  "scaleBar": true,
  "combined": true,
  "editor": true
 },
 "adminRepo": "tregodan-msu/isthmia",
 "hubSite": {
  "key": "isthmia",
  "title": "Isthmia Archives",
  "areas": {
   "Roman Bath": [
    "R. Bath",
    "Rom. Bath",
    "Bath"
   ],
   "Greek Pool": [
    "Gr. Pool"
   ],
   "East Field": [
    "East Field Hoard",
    "E. Field"
   ],
   "Fortress": [
    "Byzantine Fortress"
   ],
   "Hexamilion": [
    "Hexamilion Outworks",
    "Hexamilion Wall"
   ],
   "Northeast Gate": [
    "North East Gate",
    "NE Gate",
    "N.E. Gate",
    "East Gate"
   ],
   "South Gate": [
    "S. Gate"
   ],
   "Tower #": [
    "Tower #",
    "T. #"
   ],
   "Theater": [
    "Theatre"
   ],
   "Temple of Poseidon": [
    "Temple"
   ],
   "East Temenos": [
    "E. Temenos"
   ],
   "Temenos": [],
   "West Cemetery": [
    "W. Cemetery"
   ],
   "Northwest Area": [
    "North West Area",
    "NW Area"
   ],
   "Gully Bastion": [],
   "North Drain": [],
   "Rachi": [],
   "Stadium": [],
   "Palaimonion": []
  },
  "map": {
   "areas": true,
   "field": "Area",
   "center": [
    37.91658,
    22.993225
   ],
   "zoom": 17,
   "base": {
    "type": "osm"
   }
  },
  "places": {
   "Temple of Poseidon": [
    37.915747,
    22.993001
   ]
  }
 }
};
