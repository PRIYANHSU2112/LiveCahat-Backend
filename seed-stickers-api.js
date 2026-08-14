import dotenv from 'dotenv';
dotenv.config();

const PORT = process.env.PORT || 5000;
const BASE_URL = `http://localhost:${PORT}/api/v1`;

const ADMIN_EMAIL = 'superadmin@livechat.com';
const ADMIN_PASSWORD = 'SuperPassword123!';

async function seed() {
  try {
    console.log(`Step 1: Logging in as admin to ${BASE_URL}...`);
    const loginRes = await fetch(`${BASE_URL}/auth/admin-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
      }),
    });

    const loginData = await loginRes.json();
    if (!loginRes.ok || !loginData.success) {
      throw new Error(`Login failed: ${JSON.stringify(loginData)}`);
    }

    const token = loginData.data.token;
    console.log('Login successful! Token retrieved.');

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };

    // 2. Define Category Data
    const categoriesData = [
      {
        name: 'Expressive Emojis',
        slug: 'expressive-emojis',
        icon: '😊',
        description: 'Standard expressive emoji stickers for casual chatting.',
        sortOrder: 1,
      },
      {
        name: 'Internet Memes',
        slug: 'internet-memes',
        icon: '😂',
        description: 'Popular internet memes to keep the chats entertaining.',
        sortOrder: 2,
      },
      {
        name: 'Premium Reactions',
        slug: 'premium-reactions',
        icon: '🔥',
        description: 'Exclusive and high-value sticker reactions for top tier conversations.',
        sortOrder: 3,
      },
    ];

    const categoryMap = {};

    console.log('\nStep 2: Creating sticker categories...');
    for (const cat of categoriesData) {
      const catRes = await fetch(`${BASE_URL}/sticker-categories`, {
        method: 'POST',
        headers,
        body: JSON.stringify(cat),
      });

      const catData = await catRes.json();
      if (!catRes.ok || !catData.success) {
        // If it already exists or errors out
        console.warn(`Category "${cat.name}" creation returned status ${catRes.status}: ${catData.message || JSON.stringify(catData)}`);
        
        // Let's try to fetch categories to find the ID if it already exists
        const fetchRes = await fetch(`${BASE_URL}/sticker-categories?search=${encodeURIComponent(cat.name)}`, {
          method: 'GET',
          headers,
        });
        const fetchData = await fetchRes.json();
        if (fetchRes.ok && fetchData.success && fetchData.data.data.length > 0) {
          const existing = fetchData.data.data.find(c => c.name === cat.name);
          if (existing) {
            categoryMap[cat.name] = existing._id;
            console.log(`Found existing category "${cat.name}" with ID: ${existing._id}`);
          }
        }
      } else {
        const newCat = catData.data;
        categoryMap[cat.name] = newCat._id;
        console.log(`Created sticker category "${newCat.name}" with ID: ${newCat._id}`);
      }
    }

    // 3. Define Sticker Data
    const stickersData = [
      // Expressive Emojis (Free)
      {
        name: 'Happy Smile',
        image: 'https://api.dicebear.com/7.x/fun-emoji/svg?seed=happy',
        categoryName: 'Expressive Emojis',
        tags: ['happy', 'smile', 'joy'],
        unlockType: 'FREE',
        sortOrder: 1,
      },
      {
        name: 'Cool Sunglasses',
        image: 'https://api.dicebear.com/7.x/fun-emoji/svg?seed=cool',
        categoryName: 'Expressive Emojis',
        tags: ['cool', 'sunglasses', 'swag'],
        unlockType: 'FREE',
        sortOrder: 2,
      },
      {
        name: 'Wink Playful',
        image: 'https://api.dicebear.com/7.x/fun-emoji/svg?seed=wink',
        categoryName: 'Expressive Emojis',
        tags: ['wink', 'playful', 'cute'],
        unlockType: 'FREE',
        sortOrder: 3,
      },

      // Internet Memes (Paid in coins)
      {
        name: 'Doge Bot',
        image: 'https://api.dicebear.com/7.x/bottts/svg?seed=doge',
        categoryName: 'Internet Memes',
        tags: ['doge', 'meme', 'coin'],
        unlockType: 'PAID',
        price: 15,
        sortOrder: 1,
      },
      {
        name: 'Cyber Neko',
        image: 'https://api.dicebear.com/7.x/bottts/svg?seed=neko',
        categoryName: 'Internet Memes',
        tags: ['neko', 'cat', 'dance'],
        unlockType: 'PAID',
        price: 25,
        sortOrder: 2,
      },
      {
        name: 'Pixel Retro',
        image: 'https://api.dicebear.com/7.x/bottts/svg?seed=pixel',
        categoryName: 'Internet Memes',
        tags: ['pixel', 'retro', 'gamer'],
        unlockType: 'PAID',
        price: 35,
        sortOrder: 3,
      },

      // Premium Reactions (Unlocked at specific user levels)
      {
        name: 'Super Saiyan',
        image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=saiyan',
        categoryName: 'Premium Reactions',
        tags: ['power', 'saiyan', 'fire'],
        unlockType: 'LEVEL',
        requiredLevel: 3,
        sortOrder: 1,
      },
      {
        name: 'Neon Crown',
        image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=crown',
        categoryName: 'Premium Reactions',
        tags: ['crown', 'king', 'gold'],
        unlockType: 'LEVEL',
        requiredLevel: 5,
        sortOrder: 2,
      },
    ];

    console.log('\nStep 3: Creating stickers...');
    for (const stick of stickersData) {
      const categoryId = categoryMap[stick.categoryName];
      if (!categoryId) {
        console.error(`Skipping sticker "${stick.name}" because parent category "${stick.categoryName}" was not found or created.`);
        continue;
      }

      // Build payload matching validation schema
      const payload = {
        name: stick.name,
        image: stick.image,
        categoryId,
        tags: stick.tags,
        unlockType: stick.unlockType,
        sortOrder: stick.sortOrder,
      };

      if (stick.unlockType === 'PAID') {
        payload.price = stick.price;
      }
      if (stick.unlockType === 'LEVEL') {
        payload.requiredLevel = stick.requiredLevel;
      }

      const stickRes = await fetch(`${BASE_URL}/stickers`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      const stickData = await stickRes.json();
      if (!stickRes.ok || !stickData.success) {
        console.warn(`Sticker "${stick.name}" creation failed: ${JSON.stringify(stickData)}`);
      } else {
        console.log(`Created sticker "${stickData.data.name}" in category "${stick.categoryName}" (Unlock Type: ${stick.unlockType})`);
      }
    }

    console.log('\nDatabase seeding via APIs completed successfully!');
  } catch (error) {
    console.error('Error during API seeding:', error);
  }
}

seed();
