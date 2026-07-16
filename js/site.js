/* Public property cards and gallery. Precise hunt geography is member-only. */
var SPOTS = [
  {
    key: "sebahub",
    n: 1,
    name: "SebaHub",
    island: "Community hub",
    emoji: "",
    url: "https://sebahub.com",
    linkLabel: "Visit SebaHub →",
    img: "assets/photos/card-sebahub.jpg",
    alt: "An evening community gathering at SebaHub in Seba Beach",
    riddle: "The route returns here at the old Seba Beach School.",
    blurb: "SebaHub hosts the campaign, moderates community reports and serves as the return point for Tim's ID at 162 Second Avenue."
  },
  {
    key: "sebastays",
    n: 2,
    name: "SebaStays",
    island: "Lakeside stays",
    emoji: "",
    url: "https://sebastays.com",
    linkLabel: "Visit SebaStays →",
    img: "assets/photos/card-sebastays.jpg",
    alt: "Aerial view of the Seba Beach marina and shoreline on Wabamun Lake",
    riddle: "Cabins and shoreline stays sit near the Forest Lodge route area.",
    blurb: "SebaStays offers cabins, lodges and lakeside stays around Seba Beach. Check current access notices before searching near guest areas."
  },
  {
    key: "village_vows",
    n: 3,
    name: "Village Vows",
    island: "Forest venue",
    emoji: "",
    url: "https://villagevows.com",
    linkLabel: "Visit Village Vows →",
    img: "assets/photos/card-villagevows.jpg",
    alt: "A lakeside wedding ceremony under a floral arch at the Forest Lodge",
    riddle: "A ceremony venue stands among the pines near the Lodge Trails.",
    blurb: "Village Vows is a woodland wedding venue at the Forest Lodge. Respect private events and follow all current access labels."
  },
  {
    key: "kokanee_rv",
    n: 4,
    name: "Kokanee Springs RV Park",
    island: "RV grounds",
    emoji: "",
    url: "https://www.google.com/maps/search/?api=1&query=Kokanee+Springs+RV+Park+Seba+Beach+Alberta",
    linkLabel: "View location information →",
    img: "assets/photos/card-kokanee.jpg",
    alt: "A camper trailer parked among tall spruce trees at Kokanee Springs RV Park",
    riddle: "The route passes the campground entrance, office and driving range.",
    blurb: "Kokanee Springs is an 18-lot RV park and an active guest area. Search only where current campaign access labels permit."
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
          '</span><span class="label">Photo coming soon</span></div></div>';
    return (
      '<article class="card">' +
        '<div style="position:relative">' +
          '<span class="card__num">' + s.n + "</span>" +
          media +
        "</div>" +
        '<div class="card__body">' +
          '<p class="card__island">' + s.island + "</p>" +
          "<h3>" + s.name + "</h3>" +
          '<div class="riddle">' + s.riddle + "</div>" +
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
    { src: "assets/photos/gallery-woods.jpg", label: "The wooded route near the Forest Lodge", alt: "A wooden ceremony deck among the aspens at the Forest Lodge" },
    { src: "assets/photos/gallery-kokanee-sign.jpg", label: "Kokanee Springs — the front gate", alt: "The Kokanee Springs campground entrance sign with Adirondack chairs and flags" },
    { src: "assets/photos/gallery-ceremony.jpg", label: "The lakeside ceremony grounds", alt: "A lakeside wedding ceremony at the Forest Lodge" },
    { src: "assets/photos/gallery-sebahub-open.jpg", label: "SebaHub is open — return the ID here", alt: "A SEBAHUB IS OPEN banner on a chain-link fence by the ball field" },
    { src: "assets/photos/gallery-powwow.jpg", label: "Community days at the old school", alt: "A dancer in regalia at a Seba Beach community gathering" }
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
        '<div class="ph__inner"><span class="icon">' + (t.icon || "Photo") + "</span>" +
        '<span class="label">' + t.label + "</span></div>" +
      "</div>"
    );
  }).join("");
}

/* ---------------- Mobile nav ---------------- */
function closeNav(toggle, nav, restoreFocus) {
  if (!toggle || !nav) return;
  nav.classList.remove("open");
  toggle.setAttribute("aria-expanded", "false");
  if (restoreFocus) toggle.focus();
}

function initStackedHeaderGeometry() {
  var firstRow = document.querySelector(".case-strip");
  if (!(firstRow instanceof HTMLElement)) return;
  var secondRow = document.querySelector(".campaign-header");
  if (!(secondRow instanceof HTMLElement)) return;

  var root = document.documentElement;
  var frame = 0;

  function minimumHeight(name, fallback) {
    var value = Number.parseFloat(window.getComputedStyle(root).getPropertyValue(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function writeGeometry() {
    frame = 0;
    var firstHeight = Math.max(firstRow.getBoundingClientRect().height, minimumHeight("--campaign-case-min-height", 54));
    var secondHeight = Math.max(secondRow.getBoundingClientRect().height, minimumHeight("--campaign-nav-min-height", 66));
    root.style.setProperty("--case-strip-height", firstHeight + "px");
    root.style.setProperty("--campaign-nav-height", secondHeight + "px");
    root.style.setProperty("--stacked-header-height", firstHeight + secondHeight + "px");
  }

  function scheduleGeometry() {
    if (frame) return;
    frame = window.requestAnimationFrame(writeGeometry);
  }

  writeGeometry();
  window.addEventListener("resize", scheduleGeometry);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleGeometry);

  if (typeof window.ResizeObserver === "function") {
    var resizeObserver = new window.ResizeObserver(scheduleGeometry);
    resizeObserver.observe(firstRow);
    resizeObserver.observe(secondRow);
  } else if (typeof window.MutationObserver === "function") {
    var mutationObserver = new window.MutationObserver(scheduleGeometry);
    var mutationOptions = { attributes: true, childList: true, characterData: true, subtree: true };
    mutationObserver.observe(firstRow, mutationOptions);
    mutationObserver.observe(secondRow, mutationOptions);
  }
}

function initNav() {
  var toggle = document.querySelector(".campaign-menu-toggle");
  var nav = document.getElementById("campaign-nav");
  if (!toggle || !nav) return;
  toggle.addEventListener("click", function () {
    var open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
  nav.addEventListener("click", function (event) {
    if (event.target instanceof Element && event.target.closest("a")) closeNav(toggle, nav, false);
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && nav.classList.contains("open")) {
      closeNav(toggle, nav, true);
    }
  });
  if (typeof window.matchMedia !== "function") return;
  var desktop = window.matchMedia("(min-width: 761px)");
  var closeAtDesktop = function (event) {
    if (event.matches) closeNav(toggle, nav, false);
  };
  if (typeof desktop.addEventListener === "function") desktop.addEventListener("change", closeAtDesktop);
  else if (typeof desktop.addListener === "function") desktop.addListener(closeAtDesktop);
}

document.addEventListener("DOMContentLoaded", function () {
  renderCards();
  renderGallery();
  initStackedHeaderGeometry();
  initNav();
});
