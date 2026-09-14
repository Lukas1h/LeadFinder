import { db } from "../src/db";
import { agents, messagePresets, messagePresetVariants, messageSends } from "../src/db/schema";
import { eq, and } from "drizzle-orm";
import { sendEmail } from "../src/lib/mailer";
import { renderSubject, renderMessageBody } from "../src/lib/messageTemplate";

const DELAY_MS = 45_000;

interface Candidate {
  name: string;
  email: string;
  phone: string | null;
}

const candidates: Candidate[] = [
  { name: "Falisha Alaniz", email: "falishalaniz@gmail.com", phone: "503-580-0686" },
  { name: "Jamison Albrecht", email: "jalbrecht702@gmail.com", phone: "702-461-0151" },
  { name: "Carolyn Alexander", email: "c.alexander4homes@gmail.com", phone: "503-851-7024" },
  { name: "Nancy Alley", email: "nralleyrealtor@gmail.com", phone: "503-510-5326" },
  { name: "Peter Alotta", email: "paalotta@yahoo.com", phone: "503-851-5312" },
  { name: "Michael Andersen", email: "mandersen@hsmartrg.com", phone: "503-881-9029" },
  { name: "Maria Anderson", email: "maria.anderson0518@gmail.com", phone: "503-951-0517" },
  { name: 'Jose "Joe" Arechiga Molinar', email: "joearechiga.re@gmail.com", phone: "971-720-7625" },
  { name: "Shanna Ashenfelter", email: "shanna.homes4u@gmail.com", phone: "503-791-1180" },
  { name: 'Antonio "Tony" Balderrama', email: "tony.realtor@aol.com", phone: "310-251-8326" },
  { name: "Staci Barnes", email: "stacilbarnes@gmail.com", phone: "541-914-8126" },
  { name: "Liliana Andrea Barron-Rivas", email: "lilybarronr@gmail.com", phone: "503-930-2989" },
  { name: "Ismael Zuniga Belman", email: "ismaelrealtor1@gmail.com", phone: "503-931-1969" },
  { name: "Renae Bendix", email: "renae.bendix@outlook.com", phone: "503-689-3691" },
  { name: "Lauren Berg", email: "brokerlaurenberg@gmail.com", phone: "541-799-5454" },
  { name: "Char Berry", email: "charberryagent4homesmart@gmail.com", phone: "541-410-3662" },
  { name: "Whitney Beyer", email: "whitneybeyer.realtor@gmail.com", phone: "503-689-5255" },
  { name: "Ryan Bloedel", email: "ryan@trademarkenterprises.com", phone: "503-931-9588" },
  { name: "Tyler Blythe", email: "tblythehomesales@gmail.com", phone: "503-509-0880" },
  { name: "Vassa Bodunov", email: "vassathebuilder@gmail.com", phone: "503-951-1020" },
  { name: 'Patricia "Patty" Bolstad', email: "pattybolstad@gmail.com", phone: "503-881-4570" },
  { name: "Robin Bonnie", email: "robinbonnie.or@gmail.com", phone: "503-522-6095" },
  { name: "Tiffany Bouchard", email: "tiffanyb.realty@gmail.com", phone: "503-871-5929" },
  { name: "Denise Bowers", email: "denisebowersrealtor@gmail.com", phone: "503-930-4562" },
  { name: "Leigh Bradstreet", email: "bradstreetleigh@gmail.com", phone: "503-949-5345" },
  { name: "Alicia Brandt", email: "aliciabrandt@live.com", phone: "503-930-5384" },
  { name: "Edgar Brauer", email: "edbrauer@gmail.com", phone: "503-509-8980" },
  { name: 'Nancy "Nan" Brett', email: "nanbrett1@gmail.com", phone: "503-949-1570" },
  { name: "Steve Brown", email: "steve@stevebrown.realtor", phone: "503-510-5287" },
  { name: "Valerie Brown", email: "vbrownre2022@gmail.com", phone: "503-269-4227" },
  { name: "Angel Cabrera", email: "angel.homesmart@gmail.com", phone: "503-999-3799" },
  { name: "Cathi Caldwell", email: "cathihomesmart@gmail.com", phone: "503-999-5731" },
  { name: "David Cale", email: "cabdrc@comcast.net", phone: null },
  { name: "Wendy Carpenter-Major", email: "majorsellsoregon@gmail.com", phone: "541-990-7398" },
  { name: "Christina Casper", email: "connect@christinacasper.com", phone: "503-910-5047" },
  { name: "Michael Cassata", email: "sellingthepnw@outlook.com", phone: "971-428-8972" },
  { name: "Nora Gisela Castro Ulloa", email: "nora.castrobroker@gmail.com", phone: "971-218-6932" },
  { name: "Shyra Castronovo", email: "shyra@salemkeizerhomes.com", phone: "503-559-8248" },
  { name: "Courtney Chandler", email: "listwithcourtney@hotmail.com", phone: "503-910-5202" },
  { name: "Justin Cherrington", email: "justincherrington@protonmail.com", phone: "503-510-8341" },
  { name: "Daniel Chin", email: "dschin23@gmail.com", phone: "503-999-2217" },
  { name: "Linda Clemente", email: "lindasellsoregon@gmail.com", phone: "503-474-8106" },
  { name: "Scott Collins", email: "scottcollinsrealtor@gmail.com", phone: "503-580-0896" },
  { name: "Zach Conklin", email: "zconklin03@gmail.com", phone: "541-390-6270" },
  { name: "Kristin Contras", email: "kristin@valleygirlrealestate.com", phone: "503-990-4414" },
  { name: "Vanessa Quevedo Coria", email: "vanessa@quevcor.com", phone: "503-302-9399" },
  { name: "Maria Reyes Corral", email: "reyes.homesales@gmail.com", phone: "503-309-6418" },
  { name: "Richard Crafts", email: "oregonizedrealestatellc@gmail.com", phone: "503-884-4232" },
  { name: "McKenzie Cuanas", email: "mckenziesellsoregon@gmail.com", phone: "503-507-5393" },
  { name: "Kim Daley", email: "kimdaleyrealtor@gmail.com", phone: "503-380-0558" },
  { name: "Keaton Davis", email: "keatonpagerealtor@gmail.com", phone: "503-931-4110" },
  { name: "Sim Dhote", email: "simd.realestate@gmail.com", phone: null },
  { name: "Bailey Dysinger", email: "baileyoregonrealtor@gmail.com", phone: null },
  { name: "Molly Edwards", email: "rebrokermolly@gmail.com", phone: "503-999-7519" },
  { name: "Trevor Elliott", email: "trevor@eteamre.com", phone: "503-602-1039" },
  { name: "Steven Elmore", email: "34realtorsteve@gmail.com", phone: "503-983-6999" },
  { name: "Cameron Estes", email: "camestes17@gmail.com", phone: "503-991-8537" },
  { name: "Steve Evans", email: "stevetravels2@gmail.com", phone: "503-949-5263" },
  { name: "Randy Evans", email: "randy@randyevans.realtor", phone: "503-539-8367" },
  { name: "Shakir Evans", email: "shakir.evans3@gmail.com", phone: "315-383-9493" },
  { name: "Jessica Farrell", email: "jessicafarrell.realtor@gmail.com", phone: "503-884-5055" },
  { name: "Lisa Farrow", email: "lbloedel@hotmail.com", phone: "503-931-1145" },
  { name: "Mark Farrow", email: "mfarrow@hsmartrealtygroup.com", phone: "503-559-9901" },
  { name: "Richard Feredinos", email: "richard.feredinoshomes@gmail.com", phone: "503-559-3913" },
  { name: "Jolene Ferschweiler", email: "jolenesrealestate@gmail.com", phone: "503-975-7864" },
  { name: 'Pamela "Pam" Fields', email: "pamfields.homesmart@gmail.com", phone: "503-580-3261" },
  { name: "Chris Forrette", email: "c4rette@gmail.com", phone: "503-409-3542" },
  { name: "Theresa Fowler", email: "theresafowler.homesmart@gmail.com", phone: "503-990-0045" },
  { name: "Rob Freeborn", email: "robertsellsoregon@gmail.com", phone: null },
  { name: "Nolan Fridley", email: "nolan@fridleycustomhomes.com", phone: "503-851-2932" },
  { name: "Bruce Friedrichsen", email: "brucef.realtor@gmail.com", phone: "503-999-6700" },
  { name: "Leeann Friend", email: "friendinrealestate@yahoo.com", phone: "503-871-8544" },
  { name: "Allison Galvin", email: "allisongalvin@gmail.com", phone: "503-576-1635" },
  { name: 'Ricardo "Ricky" Garcia', email: "rickywvhomes@gmail.com", phone: "503-507-0724" },
  { name: "Ruben Garibay", email: "garibayrealtyteam@gmail.com", phone: null },
  { name: "Erin Garibay", email: "garibayrealtyteam@gmail.com", phone: "503-871-2672" },
  { name: "Leigh Tracey-Gaynair", email: "leighatgrealtor@gmail.com", phone: "541-948-9312" },
  { name: "Lauren Gesik", email: "homewithlauren@gmail.com", phone: "503-559-6376" },
  { name: "Amanda Green", email: "amandag@hsmartrg.com", phone: "503-551-5005" },
  { name: "Ronda Grefenson", email: "rondagrealtor@gmail.com", phone: "503-931-5508" },
  { name: 'Pamela "Pam" Gregory', email: "pamg@hsmartrealtygroup.com", phone: "503-580-7381" },
  { name: "Marta Guajardo", email: "martamarieg@gmail.com", phone: "971-600-4893" },
  { name: "Shareef Hagag", email: "shareef.hagag@gmail.com", phone: "503-510-2607" },
  { name: "Rebecca Hammagren", email: "rhammagren@gmail.com", phone: "503-508-0422" },
  { name: "Courtney Harris", email: "courtney@smartoregonhomes.com", phone: "503-385-7519" },
  { name: "Joseph Hayes", email: "hayesrealtyteam@gmail.com", phone: "503-999-8222" },
  { name: "Natasha Hayes", email: "hayesrealtyteam@gmail.com", phone: "503-999-8222" },
  { name: "Luke Hayes", email: "lukehayes@hayesrealtyteam.net", phone: "541-801-0292" },
  { name: 'Wesley "Wes" Helmer', email: "wes@teamhelmer.com", phone: "503-871-0466" },
  { name: "Michelle Hendricks", email: "hendricksmichelle3@gmail.com", phone: "503-551-1855" },
  { name: "Gabriela Hernandez", email: "g.hernandez_ramirez@yahoo.com", phone: "971-900-6671" },
  { name: "Paul Hill", email: "hill.paul.david@gmail.com", phone: "971-218-9142" },
  { name: "Sheryll Hodson", email: "sheryll.hodson@gmail.com", phone: "503-899-7805" },
  { name: "Jeffrey Hodson", email: "jeffhodson24@gmail.com", phone: "503-856-5643" },
  { name: 'Andrea "Ande" Hofmann', email: "rickandrea@aol.com", phone: "503-881-3888" },
  { name: 'Richard "Rick" Hofmann', email: "rickandrea@aol.com", phone: "503-881-3888" },
  { name: "Troy Howell", email: "howell_86@yahoo.com", phone: "541-971-1632" },
  { name: "Tina Hurlbutt", email: "tinahurlbutt.realtor@gmail.com", phone: "503-551-6256" },
  { name: "Adam Jaramillo", email: "ajaramillo.realtor@gmail.com", phone: "503-851-1826" },
  { name: "Darrell Johnson", email: "darrellj@hsmartrg.com", phone: "503-798-5005" },
  { name: "Chad Jones", email: "chjones06@gmail.com", phone: "503-689-2557" },
  { name: "Maya Jones", email: "soldbymayajones@gmail.com", phone: "971-218-9784" },
  { name: "Jose Quiroz Jr", email: "josequiroz.realtor@gmail.com", phone: "503-409-8361" },
  { name: 'Robert "Bob" Reynolds Jr.', email: "renroost@aol.com", phone: "503-580-6574" },
  { name: "Sherri Junker", email: "rsbbjunker@comcast.net", phone: "503-551-0262" },
  { name: "Maya Kennedy", email: "mayakennedyre@gmail.com", phone: "541-248-9318" },
  { name: "Tiffany Joy Kerlegan", email: "thejoyteam@outlook.com", phone: null },
  { name: 'Christina "Tina" Kessler', email: "tkessler@hsmartrg.com", phone: "971-599-5871" },
  { name: "Susan Killen", email: "killenrealtor2@gmail.com", phone: "503-302-6628" },
  { name: "Matt Killen", email: "killenrealtor@gmail.com", phone: "503-409-5023" },
  { name: "Christina Kreitzberg", email: "christinasellsoregon@gmail.com", phone: "707-293-5474" },
  { name: 'Karapet "Gary" Krtikashyan', email: "dreamlandyeti@gmail.com", phone: "503-374-6836" },
  { name: "Shelby Kutz", email: "shelbykutz20@gmail.com", phone: "503-881-9970" },
  { name: "Carlos Landa", email: "carlos@avantestategroup.com", phone: "503-383-2036" },
  { name: "Brandon Lao", email: "brandonlaorealestate@gmail.com", phone: "503-269-2183" },
  { name: 'Albert "AJ" Lape', email: "ajlape@hsmartrg.com", phone: "503-409-5358" },
  { name: "Yuriy Latik", email: "yuriyhomesmart@gmail.com", phone: null },
  { name: 'Abigayle "Abby" Lauridsen', email: "abby.homesmartrg@gmail.com", phone: "951-442-9683" },
  { name: "Wenona Leeder", email: "realtorleeder@gmail.com", phone: "503-269-2857" },
  { name: "Karolina Lemus", email: "karolinarealty@gmail.com", phone: "971-806-4061" },
  { name: "Caden Leno", email: "lenopropertyinvestments@gmail.com", phone: "503-798-7793" },
  { name: "Jason Leon", email: "jason@riserealty.org", phone: "503-851-7138" },
  { name: "Ron Liedkie", email: "ronliedkie@gmail.com", phone: "503-507-7549" },
  { name: "Garnet Long", email: "garnet.long@comcast.net", phone: "503-302-7822" },
  { name: "Chase Lopez", email: "chasethehouses@gmail.com", phone: "541-401-9467" },
  { name: "Michael Lowery", email: "michaelloweryrealestate@gmail.com", phone: "503-580-3090" },
  { name: "Alejandro Lumbreras", email: "alejandro.lumbreras@gmail.com", phone: "503-559-6766" },
  { name: 'Donald "Don" Madsen', email: "donaldemadsen@gmail.com", phone: "503-851-1366" },
  { name: "Andre Makarenko", email: "comforthomespnw@gmail.com", phone: "503-409-2282" },
  { name: "Ilya Makarenko", email: "ilya.comforthomespnw@gmail.com", phone: "503-409-3738" },
  { name: "Scott Manning", email: "scottjasonmanning@gmail.com", phone: "503-949-6347" },
  { name: "Susan Mason", email: "masonteam@cs.com", phone: "503-551-7811" },
  { name: "Karen McCoy", email: "karenmccoybroker@gmail.com", phone: "503-930-7001" },
  { name: "Lexi McKay", email: "leximckaybroker@gmail.com", phone: "971-218-5366" },
  { name: "Rick McKee", email: "mckeecohomes@gmail.com", phone: "541-922-8715" },
  { name: "Kristi McMurry", email: "reagentmcmurry@gmail.com", phone: "208-914-4694" },
  { name: "Jamie Melcher", email: "jamie@melchershomesales.com", phone: "541-401-1991" },
  { name: 'Robert "Rob" Melton', email: "robmelton9@gmail.com", phone: "503-930-9230" },
  { name: "Nicole Meuret", email: "nicolemeuret@gmail.com", phone: "503-871-7282" },
  { name: "Larry Miles", email: "larrymilesrealtor@gmail.com", phone: "503-580-5927" },
  { name: "Kathleen Milldrum", email: "kathleen@pnwcoast.com", phone: null },
  { name: "James Montgomery", email: "jamesm@hsmartrealtygroup.com", phone: "503-779-4770" },
  { name: "Jason Moore", email: "jndfarm2@gmail.com", phone: "541-990-5554" },
  { name: "Austin Natividad", email: "natividadaustin@hotmail.com", phone: "503-428-2400" },
  { name: "Shane Newton", email: "shanenewton78@gmail.com", phone: "503-910-6904" },
  { name: "Derek Nichols", email: "dereknichols@hayesrealtyteam.net", phone: null },
  { name: "Brian Niewald", email: "brianniewald@gmail.com", phone: "503-409-3958" },
  { name: "Roxanne Noud", email: "roxannenoud@gmail.com", phone: "503-689-4796" },
  { name: "Eve Olsen", email: "eve@olsencommunities.com", phone: "503-559-8837" },
  { name: "Bailey Olson", email: "baileyhomesmart@gmail.com", phone: "503-559-1597" },
  { name: "Vanessa Orozco", email: "vanessaorozcorealtor@gmail.com", phone: null },
  { name: "Ralph Osburn", email: "ralph@theosburngroup.com", phone: "503-476-5640" },
  { name: "Teresa Owings", email: "teresayowings@gmail.com", phone: "503-936-7253" },
  { name: "Sarah Owre", email: "sarahowre@gmail.com", phone: "503-428-1324" },
  { name: "Stephen G. Tandy", email: "listwithme@stevetandy.com", phone: "503-580-1483" },
  { name: 'Jeffrey "Jeff" Parsons', email: "jeffparsons11@gmail.com", phone: "503-413-0350" },
  { name: "Rosalie Peck", email: "rosaliepeck52@gmail.com", phone: "971-400-0850" },
  { name: "Theresa Peltier", email: "rebrokertheresapeltier@gmail.com", phone: "541-979-3718" },
  { name: "Amber Pena", email: "amberpena.realtor@gmail.com", phone: "209-556-2624" },
  { name: "Elva Pinto", email: "pintoe23@gmail.com", phone: "541-571-6476" },
  { name: "Erica Plumb", email: "ericaplumb6@gmail.com", phone: "971-218-2595" },
  { name: 'Kathryn "Kathy" Power', email: "kathypowerrealtor@gmail.com", phone: "503-881-6680" },
  { name: "Amy Price", email: "homewithamy@outlook.com", phone: "541-990-2146" },
  { name: "Vanessa Price Riley", email: "manyblessings111@gmail.com", phone: "808-268-6946" },
  { name: "Amy Pulver", email: "apulver1724@gmail.com", phone: "602-703-7816" },
  { name: "Julio Quevedo", email: "julio@quevcor.com", phone: "503-779-6766" },
  { name: "Chantelle Ramcharan", email: "homesmartsisters@gmail.com", phone: "503-428-4492" },
  { name: 'Lucita "Lucy" Vasquez Ramirez', email: "teamreal777@gmail.com", phone: "971-219-8699" },
  { name: "Heather Rauh", email: "heather@heatherrauh.com", phone: "971-373-5379" },
  { name: "Taylor Ream", email: "taylor.ream3@gmail.com", phone: "503-881-8733" },
  { name: "Bethany Reeves", email: "bethanyrealtor1@gmail.com", phone: "503-897-8488" },
  { name: "Marianne Reich", email: "marianne@reichhomes.com", phone: "503-569-9557" },
  { name: "Troy Renshaw", email: "troyrenshaw2@comcast.net", phone: "503-931-7266" },
  { name: "Alba Reyes", email: "reyesalba.17@gmail.com", phone: null },
  { name: "Chandra Reynolds", email: "homesmartsisters@gmail.com", phone: "503-428-4491" },
  { name: "Jennifer Reynolds", email: "oregonslivingroom@gmail.com", phone: "503-381-6573" },
  { name: "Stacey Robbins", email: "robbinsroostrealtor@gmail.com", phone: "541-948-9332" },
  { name: "Victoria Rozo Robblee", email: "victoria@therobbleegroup.com", phone: "971-330-3660" },
  { name: "Scott Robblee", email: "scott@therobbleegroup.com", phone: "503-798-8737" },
  { name: 'Sylvestra "Sylvia" Rodriguez', email: "sylviarodbroker@gmail.com", phone: "503-932-9835" },
  { name: "Rhonda Romp", email: "rhondaromp2@gmail.com", phone: "503-510-3138" },
  { name: "Natalie Rybakov", email: "nrybakov@msn.com", phone: "503-990-2782" },
  { name: "Justin Samiee", email: "js@justinsamiee.com", phone: "503-508-7147" },
  { name: "Amelia Sarmiento", email: "sarmientogrouprealty@gmail.com", phone: "816-516-4326" },
  { name: "Lisa Scheirman", email: "realtorlisa@scheirman.us", phone: "503-949-2411" },
  { name: "Dana Schell", email: "dana@realtordana.com", phone: "503-320-9261" },
  { name: "Steve Schelske", email: "rockfarmrealestate@gmail.com", phone: "541-420-1868" },
  { name: 'Jon Derek "Derek" Schumpert', email: "dschumpert@hsmartrg.com", phone: "503-602-8909" },
  { name: "Bob Shackelford", email: "bobshack1@gmail.com", phone: "503-983-4086" },
  { name: "Benjamin Shedd", email: "sheddb32@gmail.com", phone: "503-385-6544" },
  { name: 'Jonathon "Brody" Sherwood', email: "brody.sherwood@gmail.com", phone: "503-383-4992" },
  { name: "Shawn Shukle", email: "shawn@shuklerealty.com", phone: "503-270-8485" },
  { name: "Tina Smith", email: "homes@harborside.com", phone: "541-992-5460" },
  { name: "Brian Smith", email: "briansmithrealtor@gmail.com", phone: "503-551-8510" },
  { name: "Tabitha Solberg", email: "tabithasrealtor@gmail.com", phone: "503-910-2244" },
  { name: "Emily Sorce", email: "emsorce@gmail.com", phone: "541-297-7322" },
  { name: "Kristin Sparkman", email: "jrksparkman@gmail.com", phone: "503-910-6305" },
  { name: "Jim Sparkman", email: "jims@hsmartrealtygroup.com", phone: "503-910-8414" },
  { name: "Krystal Sprauer", email: "kbsprauer@gmail.com", phone: "503-910-9071" },
  { name: "Vera Stanley", email: "verastanleybroker@gmail.com", phone: "503-269-8706" },
  { name: "Ryan Steckly", email: "rsteckly@me.com", phone: "503-507-1808" },
  { name: "Devann Steiner", email: "devann@steinerhomesales.com", phone: "971-209-8097" },
  { name: "Don Sturgeon", email: "brokerdonsturgeon@gmail.com", phone: "503-508-1800" },
  { name: 'McKenzie "Kenzie" Sturgeon', email: "brokerkenziesturgeon@gmail.com", phone: "503-881-7107" },
  { name: "Tracy Sturgeon", email: "brokertracysturgeon@gmail.com", phone: "503-881-1939" },
  { name: "Dena Swift", email: "swift@hsmartrealtygroup.com", phone: "503-510-0489" },
  { name: "Krista Terlecki", email: "terleckihouse@gmail.com", phone: "503-871-2508" },
  { name: "Suzi White-Thorud", email: "suziwhite@gmail.com", phone: "503-884-2954" },
  { name: "Kristi Tomlin", email: "kristitomlin7@gmail.com", phone: "503-884-5252" },
  { name: "Chun Truong", email: "homesforsalesalem@gmail.com", phone: "503-851-3167" },
  { name: 'Jennifer "Jenny" Vanlue', email: "jennyvanluerealtor@gmail.com", phone: "503-347-8392" },
  { name: "Barbara Vetter", email: "valleyhomeadvisors.barb@gmail.com", phone: "503-208-0219" },
  { name: "Jodee Walton", email: "jodee@myagentjodee.com", phone: "541-554-2777" },
  { name: "Lexie Weathers", email: "lexie@weathershomesolutions.com", phone: "503-551-0621" },
  { name: "Kevin Weathers", email: "kevin@weathershomesolutions.com", phone: "503-881-8530" },
  { name: "Bridget Welborn", email: "bridgetsellsoregonhomes@gmail.com", phone: "503-510-6580" },
  { name: "Ryan Welty", email: "ryanrwelty@gmail.com", phone: "971-398-7093" },
  { name: "Mia White", email: "miarosebud@gmail.com", phone: "406-581-3551" },
  { name: "Katie Whitten", email: "katie@bridgetownfiles.com", phone: "503-806-6709" },
  { name: "David Wiggers", email: "dwigs21@gmail.com", phone: "503-851-8622" },
  { name: "Amy Williams", email: "amywhousehunter@gmail.com", phone: "503-881-4233" },
  { name: "Charles Wilson", email: "cwa951@gmail.com", phone: "503-339-6954" },
  { name: "Megan Wong", email: "mmwong02@gmail.com", phone: "503-851-8887" },
  { name: "Nathan Wu", email: "nathanwu128@gmail.com", phone: null },
  { name: "Heather Yates", email: "heather.yatesrealestate@gmail.com", phone: "503-383-9185" },
  { name: 'Alemayehu "Alex" Yetayew', email: "alexyetayew@gmail.com", phone: "202-330-1931" },
  { name: "Zachary Zeek", email: "zachary_zeek@hotmail.com", phone: "503-551-8836" },
];

async function main() {
  const startedAt = Date.now();
  const [preset] = await db
    .select()
    .from(messagePresets)
    .where(
      and(
        eq(messagePresets.channel, "email"),
        eq(messagePresets.type, "initial_outreach"),
        eq(messagePresets.name, "Cold Outreach")
      )
    );
  if (!preset) throw new Error('"Cold Outreach" email preset not found');
  const [variant] = await db.select().from(messagePresetVariants).where(eq(messagePresetVariants.presetId, preset.id));
  if (!variant) throw new Error("No variant found for Cold Outreach preset");

  let sent = 0,
    skipped = 0,
    failed = 0;
  const failedNames: string[] = [];

  for (const r of candidates) {
    const email = r.email.trim().toLowerCase();
    const name = r.name.trim();
    const phone = r.phone || null;

    const [existing] = await db.select().from(agents).where(eq(agents.email, email));
    if (existing?.lastContactedAt) {
      console.log(`SKIP ${name} — already contacted`);
      skipped++;
      continue;
    }

    const subject = renderSubject(variant.subject ?? "", name);
    const body = renderMessageBody(variant.body, name, null);

    try {
      await sendEmail({ to: email, toName: name, subject, text: body, attachments: preset.attachments });
    } catch (err) {
      console.log(`FAILED ${name} <${email}> — ${err}`);
      failed++;
      failedNames.push(`${name} <${email}>`);
      await new Promise((r) => setTimeout(r, DELAY_MS));
      continue;
    }

    const now = new Date();
    let agentId: string;
    try {
      if (existing) {
        await db
          .update(agents)
          .set({ name, lastContactedAt: now, phone: existing.phone ?? phone })
          .where(eq(agents.id, existing.id));
        agentId = existing.id;
      } else {
        const [inserted] = await db.insert(agents).values({ email, name, phone, lastContactedAt: now }).returning({ id: agents.id });
        agentId = inserted.id;
      }
    } catch (err) {
      console.log(`WARN ${name} <${email}> — agent upsert failed (likely phone collision), retrying without phone — ${err}`);
      if (existing) {
        await db.update(agents).set({ name, lastContactedAt: now }).where(eq(agents.id, existing.id));
        agentId = existing.id;
      } else {
        const [inserted] = await db.insert(agents).values({ email, name, phone: null, lastContactedAt: now }).returning({ id: agents.id });
        agentId = inserted.id;
      }
    }

    await db.insert(messageSends).values({
      listingId: null,
      agentId,
      presetId: preset.id,
      variantId: variant.id,
      type: "initial_outreach",
      channel: "email",
      sentAt: now,
    });
    sent++;
    console.log(`SENT ${name} <${email}> (${sent} sent, ${skipped} skipped, ${failed} failed)`);
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.log(`DONE. Sent ${sent}, skipped ${skipped}, failed ${failed}, out of ${candidates.length}. Elapsed ${elapsedMin} min.`);
  if (failedNames.length) console.log(`Failed: ${failedNames.join("; ")}`);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
