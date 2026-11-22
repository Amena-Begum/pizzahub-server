import type { Category } from "../models/MenuItem.js";

export interface SeedVendor {
  key: string;
  name: string;
  email: string;
  businessName: string;
  city: string;
  phone: string;
  address: string;
  bio: string;
}

export interface SeedItem {
  vendor: string;
  photos: string; // key in photo-ids.json
  itemName: string;
  category: Category;
  description: string;
  price: number;
  location: string;
  status: "approved" | "pending" | "rejected" | "inactive";
  reviewNote?: string;
  /** Only added once the vendor is on Premium (npm run seed -- --premium-extras) */
  premiumExtra?: boolean;
}

export const VENDORS: SeedVendor[] = [
  {
    key: "fornaio",
    name: "Rafiq Hasan",
    email: "fornaio.napoli@pizzahub.app",
    businessName: "Fornaio Napoli",
    city: "Gulshan, Dhaka",
    phone: "+880 1711-204455",
    address: "Road 90, Gulshan 2, Dhaka",
    bio: "A 450°C wood-fired oven, 48-hour dough and San Marzano tomatoes since 2019.",
  },
  {
    key: "brick",
    name: "Nadia Karim",
    email: "brick.basil@pizzahub.app",
    businessName: "Brick & Basil",
    city: "Dhanmondi, Dhaka",
    phone: "+880 1819-338120",
    address: "Satmasjid Road, Dhanmondi 27, Dhaka",
    bio: "Vegetarian pizzeria growing its own basil on the rooftop.",
  },
  {
    key: "smokeyard",
    name: "Tanvir Ahmed",
    email: "smoke.yard@pizzahub.app",
    businessName: "Smoke Yard Pizza Co.",
    city: "Banani, Dhaka",
    phone: "+880 1552-901177",
    address: "Road 11, Banani, Dhaka",
    bio: "Slow-smoked meats, charred crusts and big appetites welcome.",
  },
  {
    key: "slice",
    name: "Sabrina Chowdhury",
    email: "slice.society@pizzahub.app",
    businessName: "Slice Society",
    city: "Uttara, Dhaka",
    phone: "+880 1612-447790",
    address: "Sector 7, Uttara, Dhaka",
    bio: "New York style slices and classic pies, folded the right way.",
  },
  {
    key: "crust",
    name: "Imran Hossain",
    email: "crust.co@pizzahub.app",
    businessName: "Crust & Co.",
    city: "Mirpur, Dhaka",
    phone: "+880 1931-660245",
    address: "Mirpur 10 Circle, Dhaka",
    bio: "The sides people come back for: garlic bread, wings and loaded fries.",
  },
  {
    key: "dolce",
    name: "Farhana Islam",
    email: "dolce.forno@pizzahub.app",
    businessName: "Dolce Forno",
    city: "Bashundhara, Dhaka",
    phone: "+880 1744-582310",
    address: "Block C, Bashundhara R/A, Dhaka",
    bio: "Desserts and cold drinks made to finish a pizza night properly.",
  },
];

export const CUSTOMERS = [
  { key: "ayesha", name: "Ayesha Rahman", email: "ayesha.customer@pizzahub.app", city: "Gulshan, Dhaka", address: "House 14, Road 103, Gulshan 2, Dhaka" },
  { key: "mahir", name: "Mahir Chowdhury", email: "mahir.customer@pizzahub.app", city: "Dhanmondi, Dhaka", address: "Flat 5B, Road 8/A, Dhanmondi, Dhaka" },
  { key: "tasnim", name: "Tasnim Akter", email: "tasnim.customer@pizzahub.app", city: "Banani, Dhaka", address: "House 33, Road 17, Banani, Dhaka" },
  { key: "arif", name: "Arif Mahmud", email: "arif.customer@pizzahub.app", city: "Uttara, Dhaka", address: "House 9, Sector 4, Uttara, Dhaka" },
];

export const ADMIN = { name: "PizzaHub Admin", email: "admin@pizzahub.app" };

export const ITEMS: SeedItem[] = [
  // Fornaio Napoli
  { vendor: "fornaio", photos: "margherita", itemName: "Margherita Napoletana", category: "Classic Pizzas", price: 11.5, location: "Gulshan, Dhaka", status: "approved",
    description: "Our signature Neapolitan pie: San Marzano tomato, fior di latte, fresh basil and a drizzle of extra virgin olive oil on a soft, leopard-spotted crust baked for 90 seconds at 450°C." },
  { vendor: "fornaio", photos: "burrata", itemName: "Burrata & Heirloom Tomato", category: "Specialty / Gourmet Pizzas", price: 17.9, location: "Gulshan, Dhaka", status: "approved",
    description: "A whole creamy burrata torn over the pie right after the bake, with blistered heirloom tomatoes, basil oil and flaky sea salt. Best shared, but no one will judge." },
  { vendor: "fornaio", photos: "diavola", itemName: "Wood-Fired Diavola", category: "Specialty / Gourmet Pizzas", price: 15.5, location: "Gulshan, Dhaka", status: "approved",
    description: "Spicy Calabrian salami, smoked mozzarella, chilli honey and a hit of oregano. Fiery, sweet and stretchy straight out of the wood oven." },
  { vendor: "fornaio", photos: "truffle-bianca", itemName: "Truffle Bianca", category: "Specialty / Gourmet Pizzas", price: 19.5, location: "Gulshan, Dhaka", status: "approved", premiumExtra: true,
    description: "A white pizza of fior di latte, roasted garlic cream, wild mushrooms and shaved black truffle, finished with parmesan and thyme." },
  { vendor: "fornaio", photos: "prosciutto", itemName: "Prosciutto & Rocket", category: "Specialty / Gourmet Pizzas", price: 18.25, location: "Gulshan, Dhaka", status: "approved", premiumExtra: true,
    description: "Tomato and mozzarella base topped after baking with thin prosciutto crudo, peppery rocket, parmesan shavings and a squeeze of lemon." },

  // Brick & Basil
  { vendor: "brick", photos: "garden", itemName: "Garden Harvest", category: "Vegetarian Pizzas", price: 12.75, location: "Dhanmondi, Dhaka", status: "approved",
    description: "Roasted bell peppers, red onion, sweet corn, cherry tomatoes and olives over mozzarella, finished with rooftop basil. Bright, colourful and filling." },
  { vendor: "brick", photos: "mushroom", itemName: "Wild Mushroom & Thyme", category: "Vegetarian Pizzas", price: 13.5, location: "Dhanmondi, Dhaka", status: "approved",
    description: "Three kinds of mushrooms sautéed in garlic butter, caramelised onions, mozzarella and fresh thyme on a crisp, golden base." },
  { vendor: "brick", photos: "mediterranean", itemName: "Mediterranean Veggie", category: "Vegetarian Pizzas", price: 13.25, location: "Dhanmondi, Dhaka", status: "pending",
    description: "Kalamata olives, artichoke hearts, sun-dried tomatoes, red onion and crumbled feta with a swirl of oregano oil. Waiting for admin approval." },
  { vendor: "brick", photos: "spinach", itemName: "Spinach & Ricotta", category: "Vegetarian Pizzas", price: 12.9, location: "Dhanmondi, Dhaka", status: "approved", premiumExtra: true,
    description: "Garlic-wilted spinach, dollops of fresh ricotta, mozzarella and a little nutmeg and lemon zest. Light, creamy and very green." },

  // Smoke Yard
  { vendor: "smokeyard", photos: "meat-feast", itemName: "Smoke Yard Meat Feast", category: "Meat Lovers", price: 16.9, location: "Banani, Dhaka", status: "approved",
    description: "Beef pepperoni, smoked chicken, spiced beef mince and turkey ham layered over mozzarella and smoky tomato sauce. For serious appetites." },
  { vendor: "smokeyard", photos: "bbq-chicken", itemName: "BBQ Chicken Ranch", category: "Meat Lovers", price: 15.25, location: "Banani, Dhaka", status: "approved",
    description: "Hickory-smoked pulled chicken, house BBQ sauce, red onion, jalapeños and a ranch drizzle on a hand-tossed crust." },
  { vendor: "smokeyard", photos: "sausage", itemName: "Spicy Sausage & Peppers", category: "Meat Lovers", price: 14.75, location: "Banani, Dhaka", status: "approved",
    description: "Fennel-spiced beef sausage, roasted red peppers, chilli flakes and mozzarella. Big flavour with a slow-building heat." },

  // Slice Society
  { vendor: "slice", photos: "pepperoni", itemName: "Classic Pepperoni", category: "Classic Pizzas", price: 12.5, location: "Uttara, Dhaka", status: "approved",
    description: "Edge-to-edge beef pepperoni that crisps into little cups, a generous blanket of mozzarella and our slow-cooked tomato sauce." },
  { vendor: "slice", photos: "four-cheese", itemName: "Quattro Formaggi", category: "Classic Pizzas", price: 13.9, location: "Uttara, Dhaka", status: "approved",
    description: "Mozzarella, gorgonzola, parmesan and smoked provolone melted together on a thin, crisp base with a touch of black pepper." },
  { vendor: "slice", photos: "pepperoni-overload", itemName: "Pepperoni Overload", category: "Meat Lovers", price: 15.9, location: "Uttara, Dhaka", status: "pending",
    description: "Double pepperoni, extra mozzarella and a hot honey finish. Submitted recently and waiting for the PizzaHub team to review." },
  { vendor: "slice", photos: "hawaiian", itemName: "Pineapple Sunrise", category: "Classic Pizzas", price: 12.25, location: "Uttara, Dhaka", status: "rejected",
    reviewNote: "Photo does not match the description. Please upload a clear photo of this pizza.",
    description: "Sweet pineapple, turkey ham and mozzarella on tomato sauce. Rejected by an admin, so customers never see it." },

  // Crust & Co.
  { vendor: "crust", photos: "garlic-bread", itemName: "Cheesy Garlic Bread", category: "Sides & Appetizers", price: 5.5, location: "Mirpur, Dhaka", status: "approved",
    description: "Thick-cut bread brushed with garlic and parsley butter, topped with mozzarella and baked until bubbling. Comes with marinara for dipping." },
  { vendor: "crust", photos: "wings", itemName: "Honey Sriracha Wings (8 pcs)", category: "Sides & Appetizers", price: 8.9, location: "Mirpur, Dhaka", status: "approved",
    description: "Crispy double-fried chicken wings tossed in honey sriracha glaze with toasted sesame and spring onion, served with cooling ranch." },
  { vendor: "crust", photos: "loaded-fries", itemName: "Loaded Cheese Fries", category: "Sides & Appetizers", price: 6.75, location: "Mirpur, Dhaka", status: "approved",
    description: "Skin-on fries smothered in cheddar sauce, crispy beef bits, jalapeños and spring onion. A side that eats like a main." },
  { vendor: "crust", photos: "calzone", itemName: "Four-Cheese Calzone", category: "Sides & Appetizers", price: 9.5, location: "Mirpur, Dhaka", status: "inactive",
    description: "Folded pizza stuffed with mozzarella, ricotta, parmesan and provolone. Currently paused by the restaurant." },

  // Dolce Forno
  { vendor: "dolce", photos: "tiramisu", itemName: "Classic Tiramisu", category: "Beverages & Desserts", price: 6.5, location: "Bashundhara, Dhaka", status: "approved",
    description: "Espresso-soaked savoiardi layered with whipped mascarpone and dusted with bitter cocoa. Made fresh every morning." },
  { vendor: "dolce", photos: "choc-cake", itemName: "Chocolate Fudge Cake", category: "Beverages & Desserts", price: 5.9, location: "Bashundhara, Dhaka", status: "approved",
    description: "Three layers of dark chocolate sponge with silky fudge frosting. Rich enough to share, good enough not to." },
  { vendor: "dolce", photos: "lemonade", itemName: "Fresh Mint Lemonade", category: "Beverages & Desserts", price: 3.5, location: "Bashundhara, Dhaka", status: "approved",
    description: "Freshly squeezed lemons, crushed mint and a little cane sugar over ice. The perfect reset between slices." },
  { vendor: "dolce", photos: "cola", itemName: "Iced Cola Float", category: "Beverages & Desserts", price: 3.9, location: "Bashundhara, Dhaka", status: "inactive",
    description: "Chilled cola with a scoop of vanilla ice cream. Paused for now while we restock." },
];

export const REVIEW_TEXTS = [
  "Arrived hot and the crust was perfectly charred. Easily the best pizza I've had delivered in Dhaka.",
  "Generous toppings and a really balanced sauce. The kitchen accepted my order within minutes.",
  "Ordered for a family dinner and everyone loved it. Will definitely order again this weekend.",
  "Crispy, cheesy and not greasy at all. The scheduled delivery came right on time.",
  "Great value for the size. Packaging kept everything warm and intact.",
  "Flavourful and fresh. I'd love a slightly spicier option, but still very good.",
  "The dough is light and airy with a proper chew. You can tell it's been proofed for days.",
  "Toppings tasted fresh, not frozen. My kids finished it before I got a second slice!",
  "Ordered for the office lunch and it was a hit. Clear updates on the order status too.",
  "Lovely smoky flavour from the oven. Delivered exactly on the day we picked.",
  "Proper portion, fair price and the restaurant replied quickly. Highly recommend.",
  "Perfect late-night treat. Still warm when it arrived, and the box kept it crisp.",
];
