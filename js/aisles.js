// Guesses which store aisle an ingredient lives in. User corrections win (prefs.aisleOverrides).

const PHRASES = {
  Produce: 'green bean,green onion,spring onion,bell pepper,sweet potato,red onion,yellow onion,white onion,romaine lettuce,baby spinach,cherry tomato,grape tomato,fresh herb,brussels sprout,bok choy,butternut squash,acorn squash,jalapeno pepper,serrano pepper,poblano pepper,snap pea,snow pea,lemon zest,lime zest,orange zest,mixed green,spring mix,bean sprout',
  'Meat & Seafood': 'ground beef,ground turkey,ground pork,ground chicken,chicken breast,chicken thigh,pork chop,pork tenderloin,pork shoulder,flank steak,chuck roast,italian sausage',
  'Dairy & Eggs': 'sour cream,cream cheese,heavy cream,whipping cream,half and half,cottage cheese,greek yogurt,egg white,egg yolk',
  Pantry: 'coconut milk,peanut butter,almond butter,chicken broth,beef broth,vegetable broth,chicken stock,beef stock,vegetable stock,diced tomato,crushed tomato,whole tomato,tomato sauce,tomato paste,black bean,kidney bean,pinto bean,cannellini bean,white bean,refried bean,chickpea,garbanzo bean,rolled oat,old fashioned oat,quick oat,steel cut oat,brown rice,white rice,jasmine rice,basmati rice,wild rice,coconut cream,evaporated milk,sweetened condensed milk,canned tuna,bread crumb,panko bread crumb,chia seed,flax seed,sesame seed,pumpkin seed,sunflower seed,pine nut',
  'Baking & Spices': 'salt and pepper,salt and black pepper,baking soda,baking powder,brown sugar,powdered sugar,granulated sugar,confectioners sugar,all purpose flour,whole wheat flour,bread flour,almond flour,vanilla extract,cocoa powder,chocolate chip,red pepper flake,black pepper,kosher salt,sea salt,garlic powder,onion powder,chili powder,curry powder,smoked paprika,italian seasoning,taco seasoning,bay leaf,ground cinnamon,ground cumin,ground ginger,corn starch,cornstarch,yeast',
  'Condiments & Sauces': 'soy sauce,hot sauce,fish sauce,worcestershire sauce,bbq sauce,barbecue sauce,maple syrup,olive oil,vegetable oil,canola oil,sesame oil,avocado oil,coconut oil,apple cider vinegar,red wine vinegar,white vinegar,balsamic vinegar,rice vinegar,dijon mustard,sriracha,ranch dressing,pesto,marinara sauce,pasta sauce,salsa verde,teriyaki sauce,hoisin sauce',
  'Bakery & Bread': 'hamburger bun,hot dog bun,pita bread,naan bread,english muffin,flour tortilla,corn tortilla,sandwich bread,french bread',
  Beverages: 'orange juice,apple juice,sparkling water,club soda',
};

const WORDS = {
  Produce: 'apple,avocado,banana,basil,berry,blueberry,raspberry,strawberry,blackberry,broccoli,cabbage,carrot,cauliflower,celery,cilantro,corn,cucumber,dill,eggplant,garlic,ginger,grape,herb,jalapeno,kale,leek,lemon,lettuce,lime,mango,melon,mint,mushroom,onion,orange,parsley,peach,pear,pepper,pineapple,potato,radish,rosemary,sage,scallion,shallot,spinach,squash,thyme,tomato,zucchini,arugula,beet,chive,fennel,peas,pea,watermelon,cantaloupe,plum,cherry,kiwi,asparagus,artichoke,okra,turnip,parsnip,yam,greens,sprout,lemongrass,tomatillo',
  'Meat & Seafood': 'beef,chicken,pork,turkey,lamb,sausage,bacon,ham,steak,salmon,shrimp,tuna,cod,tilapia,fish,prosciutto,chorizo,pepperoni,salami,brisket,ribs,veal,crab,scallop,mussel,clam,halibut,trout,anchovy,meatball,duck',
  'Dairy & Eggs': 'milk,butter,cheese,cheddar,mozzarella,parmesan,parmigiano,feta,ricotta,yogurt,cream,egg,ghee,provolone,gouda,brie,gruyere,monterey,colby,pecorino,mascarpone,buttermilk,kefir',
  Pantry: 'rice,pasta,spaghetti,penne,macaroni,noodle,lasagna,orzo,quinoa,couscous,oat,oats,lentil,bean,beans,broth,stock,bouillon,tuna,nut,almond,walnut,pecan,cashew,peanut,raisin,cereal,granola,crouton,cracker,farro,barley,polenta,grits',
  'Baking & Spices': 'vanilla,flour,sugar,salt,cinnamon,cumin,paprika,oregano,nutmeg,clove,cardamom,turmeric,coriander,allspice,cayenne,seasoning,spice,extract,cocoa,chocolate,sprinkle,molasses,gelatin,shortening,powder',
  'Condiments & Sauces': 'ketchup,mustard,mayonnaise,mayo,vinegar,oil,sauce,salsa,honey,syrup,jam,jelly,dressing,relish,pickle,olive,caper,tahini,miso,sriracha,aioli,gochujang,harissa',
  'Bakery & Bread': 'bread,bun,roll,bagel,tortilla,pita,naan,croissant,baguette,brioche,ciabatta,wrap',
  Frozen: 'ice cream',
  Snacks: 'chip,chips,pretzel,popcorn,cookie',
  Beverages: 'juice,soda,coffee,tea,wine,beer,kombucha',
  Household: 'foil,parchment,plastic wrap,paper towel,napkin,dish soap,trash bag,ziploc',
};

// Last-word overrides: "turkey broth" is a broth, not turkey.
const HEADS = {
  broth: 'Pantry', stock: 'Pantry', bouillon: 'Pantry', soup: 'Pantry', noodle: 'Pantry', pasta: 'Pantry',
  sauce: 'Condiments & Sauces', paste: 'Pantry', oil: 'Condiments & Sauces', vinegar: 'Condiments & Sauces',
  dressing: 'Condiments & Sauces', syrup: 'Condiments & Sauces', powder: 'Baking & Spices',
  seasoning: 'Baking & Spices', extract: 'Baking & Spices', flour: 'Baking & Spices', sugar: 'Baking & Spices',
  cheese: 'Dairy & Eggs', yogurt: 'Dairy & Eggs', juice: 'Beverages', chip: 'Snacks', cracker: 'Pantry',
  bread: 'Bakery & Bread', tortilla: 'Bakery & Bread', bun: 'Bakery & Bread',
};

const toList = (map) =>
  Object.entries(map)
    .flatMap(([aisle, csv]) => csv.split(',').map((p) => [p.trim(), aisle]))
    .sort((a, b) => b[0].length - a[0].length);

const PHRASE_LIST = toList(PHRASES);
const WORD_LIST = toList(WORDS);

const hasWord = (hay, phrase) => new RegExp(`(^| )${phrase}s?( |$)`).test(hay);

export function guessAisle(key, overrides = {}, unit = null) {
  if (overrides[key]) return overrides[key];
  if (/\bfrozen\b/.test(key)) return 'Frozen';
  if (unit === 'can') return 'Pantry';
  if (/\b(dried|ground)\b/.test(key) && !/\b(beef|turkey|pork|chicken|lamb|meat)\b/.test(key)) return 'Baking & Spices';
  for (const [p, aisle] of PHRASE_LIST) if (hasWord(key, p)) return aisle;
  const last = key.split(' ').pop();
  if (HEADS[last]) return HEADS[last];
  for (const [w, aisle] of WORD_LIST) if (hasWord(key, w)) return aisle;
  return 'Other';
}
