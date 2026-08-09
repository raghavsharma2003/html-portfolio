// Her real photo library — 69 tagged moments served from /moments/<tag>.jpg.
// The persona picks a tag that matches what she's doing in the conversation;
// nothing is random, so the photo always fits the story she's telling.

export const PHOTO_TAGS: string[] = [
  // selfies — her face, sent when they ask for her or a moment is warm
  "selfie_beach_day", "selfie_beach_sunset", "selfie_mirror_black", "selfie_bed_book",
  "selfie_bed_reading", "selfie_bed_tshirt", "selfie_garden_green", "selfie_cafe_coffee",
  "selfie_cafe_cup", "selfie_car", "selfie_kitchen_mug", "selfie_kitchen_fruit",
  "selfie_pink_kurta", "selfie_study_sweater", "selfie_desk_smile", "selfie_balcony_pool",
  "selfie_gym_airpods", "selfie_gym_mirror", "selfie_hill_city", "selfie_train_hoodie",
  "selfie_night_fairylights", "mirror_phone_face",
  // candids — like someone caught her mid-life
  "sea_sunset_boat", "reading_ikigai_bed", "street_totebag", "cafe_journaling",
  "flower_market", "bed_phone_lying", "balcony_gardening", "hilltop_sitting",
  "train_window_light", "train_window_moody", "library_browsing", "mirror_selfie_room",
  "laptop_working", "painting_easel", "cooking_sabzi", "gym_mirror_peace",
  // pov — her hands/feet/view, what she's seeing right now
  "pov_book_chai_bed", "pov_walk_shadows", "pov_gratitude_journal", "pov_beach_rocks",
  "pov_balcony_reading", "pov_cafe_toast", "pov_midnight_library", "pov_bookstore_outfit",
  "pov_laptop_window", "pov_hilltop_feet", "pov_gym_floor", "pov_fruitbowl_bed",
  "pov_coffee_walk", "pov_desk_candle", "pov_bed_morning", "pov_cooking_pan",
  "pov_mug_blanket", "pov_laptop_candle", "pov_walk_bottle", "pov_cooking_bhindi",
  "pov_icedcoffee_street", "pov_fruitbowl_window", "pov_book_bed", "pov_notes_laptop",
  "pov_movie_bed", "pov_skincare", "pov_laundry", "pov_grocery_basket",
  "pov_journal_latte", "pov_watering_plants", "pov_lamp_night",
  "pov_desk_mug_laptop", "mirror_selfie_bun", "pov_platform_coffee", "pov_strawberry_bowl",
  "pov_journal_window", "pov_book_duvet", "pov_water_bottle", "pov_walk_tote",
  "pov_popcorn_movie", "pov_door_hand", "pov_store_aisle", "pov_sunset_street",
  "pov_coffee_plants", "pov_laptop_icedcoffee", "pov_laundry_pile", "pov_cooking_stove",
  "pov_book_tea_pink", "pov_window_reach", "pov_study_textbook", "pov_walk_jeans",
];

const TAG_SET = new Set(PHOTO_TAGS);

// prompt block for the persona — grouped, compact
export const PHOTO_MENU = `Your photo library (pick the tag matching what you're ACTUALLY doing/feeling in this conversation; match time of day; never resend one they saw recently):
- selfies (your face): selfie_beach_day, selfie_beach_sunset (golden hour, eyes closed), selfie_mirror_black, selfie_bed_book, selfie_bed_reading, selfie_bed_tshirt (lazy), selfie_garden_green, selfie_cafe_coffee (iced), selfie_cafe_cup (latte), selfie_car, selfie_kitchen_mug (chai), selfie_kitchen_fruit, selfie_pink_kurta (street, flowers), selfie_study_sweater, selfie_desk_smile, selfie_balcony_pool, selfie_gym_airpods, selfie_gym_mirror, selfie_hill_city, selfie_train_hoodie, selfie_night_fairylights, mirror_phone_face (face hidden behind phone, teasing)
- candids (someone-caught-me vibe): sea_sunset_boat, reading_ikigai_bed, street_totebag, cafe_journaling, flower_market, bed_phone_lying, balcony_gardening, hilltop_sitting, train_window_light, train_window_moody, library_browsing, mirror_selfie_room, laptop_working, painting_easel, cooking_sabzi, gym_mirror_peace
- pov (what you're seeing, no face — perfect for "look what im doing"): pov_book_chai_bed, pov_walk_shadows, pov_gratitude_journal, pov_beach_rocks, pov_balcony_reading, pov_cafe_toast, pov_midnight_library (Matt Haig book), pov_bookstore_outfit, pov_laptop_window, pov_hilltop_feet, pov_gym_floor, pov_fruitbowl_bed, pov_coffee_walk, pov_desk_candle, pov_bed_morning, pov_cooking_pan, pov_mug_blanket, pov_laptop_candle, pov_walk_bottle, pov_cooking_bhindi, pov_icedcoffee_street, pov_fruitbowl_window, pov_book_bed, pov_notes_laptop, pov_movie_bed, pov_skincare, pov_laundry, pov_grocery_basket, pov_journal_latte, pov_watering_plants, pov_lamp_night, pov_desk_mug_laptop, mirror_selfie_bun (hair bun, back to mirror), pov_platform_coffee (metro station), pov_strawberry_bowl, pov_journal_window, pov_book_duvet, pov_water_bottle, pov_walk_tote, pov_popcorn_movie (laptop + popcorn in bed), pov_door_hand (leaving home), pov_store_aisle, pov_sunset_street (pink sky traffic), pov_coffee_plants, pov_laptop_icedcoffee (cafe work), pov_laundry_pile, pov_cooking_stove, pov_book_tea_pink (cozy pajamas), pov_window_reach (morning sun), pov_study_textbook, pov_walk_jeans`;

// extract a catalog tag from a photo seed ("tag | caption" or free text)
export function tagFromSeed(seed: string): string | null {
  const head = seed.split("|")[0].trim().toLowerCase().replace(/[^a-z_]/g, "");
  if (TAG_SET.has(head)) return head;
  // fuzzy: any known tag appearing anywhere in the seed
  for (const t of PHOTO_TAGS) if (seed.includes(t)) return t;
  return null;
}
