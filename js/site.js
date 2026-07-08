/* ============================================================
   The Great Seba Beach Treasure Hunt — behaviour
   One data source (SPOTS) feeds both the map and the cards.
   Coordinates are approximate on purpose (we're pirates).
   TODO(coords): values verified via OpenStreetMap geocoding.
   ============================================================ */

// Anchor: the village of Seba Beach, Alberta (west end of Wabamun Lake).
// Coordinates below verified via OpenStreetMap Nominatim / geocoder.ca.
var SEBA_BEACH = { lat: 53.5647671, lng: -114.7296895 };

// The four legendary spots. url = the real property site (or a map link).
// linkLabel lets us say "Visit ..." for sites and "Chart a course ..." for map pins.
var SPOTS = [
  {
    key: "sebahub",
    n: 1,
    name: "SebaHub",
    island: "Skull Rock HQ",
    emoji: "🏴‍☠️",
    lat: 53.5618, lng: -114.742,          // the old Seba Beach School, WEST across Hwy 31 (approx — confirm)
    url: "https://sebahub.com",
    linkLabel: "Visit SebaHub →",
    img: "assets/photos/card-sebahub.jpg",
    alt: "An evening community gathering at SebaHub in Seba Beach",
    riddle: "Where every venture drops its anchor first, / start yer hunt at the heart of the burgh.",
    blurb: "The flagship o' the whole fleet, where every Seba venture musters afore it sets sail. If this hunt's got a crow's nest, ye be standin' in it, ye salty dog."
  },
  {
    key: "sebastays",
    n: 2,
    name: "SebaStays",
    island: "Cozy Cove",
    emoji: "🏕️",
    lat: 53.567, lng: -114.7451,           // Forest Lodge, just NORTH of Kokanee (nudged off Village Vows)
    url: "https://sebastays.com",
    linkLabel: "Visit SebaStays →",
    img: "assets/photos/card-sebastays.jpg",
    alt: "Aerial view of the Seba Beach marina and shoreline on Wabamun Lake",
    riddle: "Rest yer weary sea-legs where the cabins hide, / a real bed by the lake for the pirate inside.",
    blurb: "Even fierce buccaneers need a proper berth. Cabins, lodges and lakeside stays at the Forest Lodge for scallywags who fancy a mattress over a barnacled deck."
  },
  {
    key: "village_vows",
    n: 3,
    name: "Village Vows",
    island: "Lovers' Lagoon",
    emoji: "💍",
    lat: 53.5666, lng: -114.7458,          // The Forest Lodge (53117 Hwy 31), just north of Kokanee
    url: "https://villagevows.com",
    linkLabel: "Visit Village Vows →",
    img: "assets/photos/card-villagevows.jpg",
    alt: "A lakeside wedding ceremony under a floral arch at the Forest Lodge",
    riddle: "In a lodge deep in the pines two hearts be tied, / where 'I do' rings out 'stead of 'arrr' cried.",
    blurb: "A woodland weddin' venue at the Forest Lodge (aye, same pines as Cozy Cove) where couples say 'I do' instead of 'arrr.' A lagoon o' love hid in the trees — kiss the bride, not the kraken."
  },
  {
    key: "kokanee_rv",
    n: 4,
    name: "Kokanee Springs RV Park",
    island: "Wheelhouse Wharf",
    emoji: "🚐",
    lat: 53.5645731, lng: -114.7464346,    // 53118 Highway 31, Parkland County
    url: "https://www.google.com/maps/search/?api=1&query=Kokanee+Springs+RV+Park+Seba+Beach+Alberta",
    linkLabel: "Chart a course →",
    img: "assets/photos/card-kokanee.jpg",
    alt: "A camper trailer parked among tall spruce trees at Kokanee Springs RV Park",
    riddle: "Eighteen berths for landlocked ships on wheels, / park yer galleon where the spring water reels.",
    blurb: "For pirates who prefer their ship to have a hitch. An 18-lot RV park where land-galleons dock by the spring water. Spark the campfire and bring the good graham crackers, matey."
  }
];

// Real Seba Beach landmarks (OSM-verified), sprinkled as bonus clue markers.
var LANDMARKS = [
  { name: "Seba Beach Heritage Museum", lat: 53.5599331, lng: -114.7361936, note: "An old church full o' lake relics and a Memory Wall. Ask the ghosts about Tim's wallet." },
  { name: "Mini Golf & Ice Cream", lat: 53.5564909, lng: -114.7382734, note: "Windmills, waffle cones, and a hole-in-one worthy of a doubloon. A fine spot to re-provision the crew." },
  { name: "The Beach & Pier", lat: 53.5535, lng: -114.7356, note: "The sandy shore and pier on Wabamun Lake, where gulls plot mutiny and stones beg to be skipped." }
];

// Known designated parking (confirmed by owner). More may be added when the hunt goes live.
var PARKING = [
  { name: "SebaHub parking lot", lat: 53.5621, lng: -114.7424, note: "Park at the old Seba Beach School, then set off on foot." },
  { name: "Kokanee Springs parking", lat: 53.5633344, lng: -114.7399789, note: "At the front main entrance, right next to the RV Pub & Grill. Grab a bite, then hunt." }
];

/* ---------------- Map ---------------- */
function initMap() {
  var mapEl = document.getElementById("map");
  if (!mapEl || typeof L === "undefined") return;

  var map = L.map("map", { scrollWheelZoom: false }).setView([SEBA_BEACH.lat, SEBA_BEACH.lng], 14);

  // Esri World Imagery — free satellite tiles, no API key.
  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution: "Tiles &copy; Esri, Maxar, Earthstar Geographics"
    }
  ).addTo(map);

  // Faint place-label overlay so folks can read street/town names.
  // Esri reference layer (same provider as the imagery, no API key).
  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, opacity: 0.9, attribution: "Labels &copy; Esri" }
  ).addTo(map);

  var bounds = [];

  function emojiIcon(emoji, big) {
    return L.divIcon({
      className: "",
      html: '<div class="emoji-pin" style="font-size:' + (big ? 34 : 24) + 'px">' + emoji + "</div>",
      iconSize: [36, 36],
      iconAnchor: [18, 34],
      popupAnchor: [0, -30]
    });
  }

  SPOTS.forEach(function (s) {
    var external = s.url.charAt(0) !== "#";
    var popup =
      (s.img ? '<img class="pop-img" src="' + s.img + '" alt="' + (s.alt || s.name) + '" />' : "") +
      '<h3>' + s.emoji + " " + s.island + "</h3>" +
      '<strong>' + s.name + "</strong>" +
      '<div class="riddle">🧭 ' + s.riddle + "</div>" +
      '<a class="pop-link" href="' + s.url + '"' +
        (external ? ' target="_blank" rel="noopener"' : "") +
        ">" + s.linkLabel + "</a>";
    L.marker([s.lat, s.lng], { icon: emojiIcon(s.emoji, true), title: s.name })
      .addTo(map)
      .bindPopup(popup);
    bounds.push([s.lat, s.lng]);
  });

  LANDMARKS.forEach(function (m) {
    L.marker([m.lat, m.lng], { icon: emojiIcon("🪧", false), title: m.name })
      .addTo(map)
      .bindPopup('<h3>🪧 ' + m.name + "</h3><div class=\"riddle\">" + m.note + "</div>");
    bounds.push([m.lat, m.lng]);
  });

  PARKING.forEach(function (p) {
    L.marker([p.lat, p.lng], { icon: emojiIcon("🅿️", false), title: p.name })
      .addTo(map)
      .bindPopup('<h3>🅿️ ' + p.name + "</h3><div class=\"riddle\">" + p.note + "</div>");
    bounds.push([p.lat, p.lng]);
  });

  if (bounds.length) {
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
  }

  // Only grab the scroll wheel once the user commits to the map.
  map.on("focus", function () { map.scrollWheelZoom.enable(); });
  map.on("blur", function () { map.scrollWheelZoom.disable(); });
}

/* ---------------- Property cards ---------------- */
function renderCards() {
  var grid = document.getElementById("card-grid");
  if (!grid) return;
  grid.innerHTML = SPOTS.map(function (s) {
    var target = s.url.charAt(0) === "#" ? "" : ' target="_blank" rel="noopener"';
    var media = s.img
      ? '<img class="card__img" src="' + s.img + '" alt="' + (s.alt || s.name) + '" loading="lazy" />'
      : '<div class="ph"><div class="ph__inner"><span class="icon">' + s.emoji +
          '</span><span class="label">Photo be comin\' soon</span></div></div>';
    return (
      '<article class="card">' +
        '<div style="position:relative">' +
          '<span class="card__num">' + s.n + "</span>" +
          media +
        "</div>" +
        '<div class="card__body">' +
          '<p class="card__island">' + s.emoji + " " + s.island + "</p>" +
          "<h3>" + s.name + "</h3>" +
          '<div class="riddle">🧭 ' + s.riddle + "</div>" +
          "<p>" + s.blurb + "</p>" +
          '<div class="card__foot"><a href="' + s.url + '"' + target + ">" + s.linkLabel + "</a></div>" +
        "</div>" +
      "</article>"
    );
  }).join("");
}

/* ---------------- Gallery placeholders ---------------- */
function renderGallery() {
  var grid = document.getElementById("gallery-grid");
  if (!grid) return;
  var tiles = [
    { src: "assets/photos/gallery-woods.jpg", label: "The woods, where the loot lies waiting", alt: "A wooden ceremony deck among the aspens at the Forest Lodge" },
    { icon: "🎥", label: "Tim counts the $5,000 in real cash", video: true },
    { src: "assets/photos/gallery-ceremony.jpg", label: "Lovers' Lagoon down by the lake", alt: "A lakeside wedding ceremony at the Forest Lodge" },
    { icon: "🎥", label: "Tim buries the loot from his side-by-side", video: true },
    { src: "assets/photos/gallery-powwow.jpg", label: "Community days at Skull Rock HQ", alt: "A dancer in regalia at a Seba Beach community gathering" },
    { icon: "🎥", label: "The big treasure reveal (someday soon!)", video: true }
  ];
  grid.innerHTML = tiles.map(function (t) {
    if (t.src) {
      return (
        '<figure class="shot">' +
          '<img src="' + t.src + '" alt="' + (t.alt || t.label) + '" loading="lazy" />' +
          '<figcaption>' + t.label + "</figcaption>" +
        "</figure>"
      );
    }
    return (
      '<div class="ph ' + (t.video ? "ph--video" : "") + '">' +
        '<div class="ph__inner"><span class="icon">' + (t.icon || "📷") + "</span>" +
        '<span class="label">' + t.label + "</span></div>" +
      "</div>"
    );
  }).join("");
}

/* ---------------- Mobile nav ---------------- */
function initNav() {
  var toggle = document.querySelector(".menu-toggle");
  var nav = document.getElementById("nav");
  if (!toggle || !nav) return;
  toggle.addEventListener("click", function () {
    var open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
  nav.addEventListener("click", function (e) {
    if (e.target.tagName === "A") {
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    }
  });
}

document.addEventListener("DOMContentLoaded", function () {
  renderCards();
  renderGallery();
  initNav();
  initMap();
});
