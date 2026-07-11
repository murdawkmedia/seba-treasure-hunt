/* Public property cards and gallery. Precise hunt geography is member-only. */
var SPOTS = [
  {
    key: "sebahub",
    n: 1,
    name: "SebaHub",
    island: "Skull Rock HQ",
    emoji: "🏴‍☠️",
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
    url: "https://www.google.com/maps/search/?api=1&query=Kokanee+Springs+RV+Park+Seba+Beach+Alberta",
    linkLabel: "Chart a course →",
    img: "assets/photos/card-kokanee.jpg",
    alt: "A camper trailer parked among tall spruce trees at Kokanee Springs RV Park",
    riddle: "Eighteen berths for landlocked ships on wheels, / park yer galleon where the spring water reels.",
    blurb: "For pirates who prefer their ship to have a hitch. An 18-lot RV park where land-galleons dock by the spring water. Spark the campfire and bring the good graham crackers, matey."
  }
];


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
    { src: "assets/photos/gallery-kokanee-sign.jpg", label: "Kokanee Springs — the front gate", alt: "The Kokanee Springs campground entrance sign with Adirondack chairs and flags" },
    { src: "assets/photos/gallery-ceremony.jpg", label: "The lakeside ceremony grounds", alt: "A lakeside wedding ceremony at the Forest Lodge" },
    { src: "assets/photos/gallery-sebahub-open.jpg", label: "SebaHub is open — return the ID here", alt: "A SEBAHUB IS OPEN banner on a chain-link fence by the ball field" },
    { src: "assets/photos/gallery-powwow.jpg", label: "Community days at the old school", alt: "A dancer in regalia at a Seba Beach community gathering" },
    { src: "assets/route/route-video-poster.jpg", label: "🎬 Watch: The Route in 81 Seconds", alt: "Title card of the route video: The Route — Retraced", href: "route.html#route-video" }
  ];
  grid.innerHTML = tiles.map(function (t) {
    if (t.src) {
      var fig =
        '<figure class="shot">' +
          '<img src="' + t.src + '" alt="' + (t.alt || t.label) + '" loading="lazy" />' +
          '<figcaption>' + t.label + "</figcaption>" +
        "</figure>";
      return t.href ? '<a class="shot-link" href="' + t.href + '">' + fig + "</a>" : fig;
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
});
