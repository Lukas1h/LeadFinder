// Slugs for agent pages: lukashahn.media/portfolio/<word>. A word reads like
// a page someone named rather than a tracking token, which matters on a link
// texted to someone who's never met Lukas. Nature and home words, nothing
// that could read oddly. When every word is taken, slugs become two words
// ("cedar-ridge"), which is plenty for years. lib/portfolioLink.ts picks.
export const PORTFOLIO_WORDS: readonly string[] = [
  "acorn", "alder", "almond", "amber", "anchor", "apple", "apricot", "arbor", "aspen", "aster",
  "aurora", "autumn", "avenue", "azure", "badger", "bamboo", "banner", "barley", "basil", "bay",
  "beacon", "beech", "berry", "birch", "bison", "blossom", "bluebird", "bluff", "breeze", "briar",
  "brook", "buckeye", "butte", "butterfly", "cabin", "cactus", "camellia", "canyon", "cardinal", "cascade",
  "cedar", "chalet", "chapel", "cherry", "chestnut", "chickadee", "cinder", "citrus", "clover", "cobble",
  "comet", "compass", "condor", "coral", "cottage", "cove", "coyote", "crane", "crescent", "crest",
  "cricket", "crystal", "cypress", "daisy", "dawn", "deer", "delta", "dogwood", "dove", "driftwood",
  "dune", "eagle", "echo", "elder", "elm", "ember", "evergreen", "falcon", "fawn", "fern",
  "fiddle", "field", "finch", "fir", "firefly", "flint", "fox", "foxglove", "garden", "garnet",
  "gazebo", "ginger", "glacier", "glade", "glen", "goldfinch", "gorge", "granite", "grove", "gull",
  "harbor", "harvest", "haven", "hawk", "hazel", "heath", "heather", "heron", "hickory", "highland",
  "hollow", "honey", "horizon", "hummingbird", "indigo", "iris", "island", "ivy", "jade", "jasmine",
  "juniper", "kestrel", "kingfisher", "lagoon", "lake", "lantern", "larch", "lark", "laurel", "lavender",
  "ledge", "lemon", "lilac", "lily", "linden", "lotus", "lupine", "magnolia", "mallard", "manzanita",
  "maple", "marigold", "marsh", "meadow", "mesa", "mint", "mist", "moon", "morning", "moss",
  "nectar", "nest", "oak", "oasis", "orchard", "orchid", "oriole", "osprey", "otter", "owl",
  "palm", "pasture", "peach", "pebble", "pelican", "pepper", "pheasant", "pine", "pinecone", "plum",
  "pond", "poplar", "poppy", "prairie", "quail", "quarry", "rain", "raven", "redwood", "reed",
  "ridge", "river", "robin", "rose", "rowan", "sage", "salmon", "sandstone", "sapling", "sequoia",
  "shore", "sierra", "sky", "sparrow", "spruce", "starling", "stone", "summit", "sunrise", "sunset",
  "swallow", "swan", "sycamore", "tamarack", "teal", "thistle", "thrush", "thyme", "tide", "timber",
  "trail", "trillium", "trout", "tulip", "tundra", "valley", "velvet", "violet", "walnut", "warbler",
  "willow", "wren", "yarrow", "yew", "zephyr", "basin", "bramble", "canopy", "clearing", "creek",
  "fjord", "glimmer", "grotto", "hearth", "homestead", "lakeside", "lodge", "meadowlark", "ocean", "overlook",
  "pinnacle", "porch", "quartz", "rapids", "sandpiper", "seaside", "skylark", "snowberry", "solstice", "spring",
  "stream", "sundial", "terrace", "thicket", "timberline", "treetop", "upland", "vista", "waterfall", "wildflower",
  "windmill", "woodland",
];

const WORD_SET = new Set(PORTFOLIO_WORDS);

/** A slug made of these words ("cedar", "cedar-ridge"), as opposed to an older random one. */
export function isWordSlug(slug: string): boolean {
  const parts = slug.split("-");
  return parts.length <= 2 && parts.every((p) => WORD_SET.has(p));
}
