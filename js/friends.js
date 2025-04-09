document.addEventListener("DOMContentLoaded", function () {
    const cards = document.querySelectorAll(".friend-card");
    cards.forEach((card) => {
        const url = card.getAttribute("data-url");
        fetchSiteMetadata(card, url, 0);

        card.addEventListener("click", () => {
            window.open(url, "_blank");
        });
    });
});

const proxyList = [
    "https://api.allorigins.win/raw?url=",
    "https://api.codetabs.com/v1/proxy?quest=",
    "https://thingproxy.freeboard.io/fetch/"
];

function fetchSiteMetadata(card, url, proxyIndex = 0) {
    // 获取自定义内容
    const customAvatar = card.getAttribute("data-custom-avatar");
    const customDesc = card.getAttribute("data-custom-desc");
    const customTitle = card.getAttribute("data-custom-title");

    if (proxyIndex >= proxyList.length) {
        console.warn(`❌ 所有代理都失败，使用后备数据: ${url}`);
        updateCardContent(card, {
            title: card.getAttribute("data-fallback-title"),
            description: card.getAttribute("data-fallback-desc"),
            favicon: null,
            avatar: card.getAttribute("data-fallback-avatar")
        });
        return;
    }

    const proxyUrl = proxyList[proxyIndex] + encodeURIComponent(url);

    fetch(proxyUrl)
        .then(response => {
            if (!response.ok) throw new Error(`代理 ${proxyIndex} 失败: ${response.status}`);
            return response.text();
        })
        .then(html => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");

            if (!doc || !doc.documentElement) {
                throw new Error("❌ 解析 HTML 失败");
            }

            console.log(`🔍 正在解析: ${url}`);
            const siteBaseUrl = new URL(url).origin;

            const metadata = {
                // 优先使用自定义标题
                title: customTitle || extractTitle(doc),
                // 优先使用自定义描述
                description: customDesc || extractDescription(doc),
                favicon: null,
                // 优先使用自定义头像
                avatar: customAvatar || extractAvatar(doc, siteBaseUrl)
            };

            // 提前查找 favicon
            metadata.favicon = extractFavicon(doc, siteBaseUrl, (faviconUrl) => {
                metadata.favicon = faviconUrl;
                updateCardContent(card, metadata);
            });

            updateCardContent(card, metadata);
        })
        .catch(error => {
            console.warn(`⚠️ 代理 ${proxyIndex} 失败，尝试下一个:`, error);
            setTimeout(() => fetchSiteMetadata(card, url, proxyIndex + 1), 500);
        });
}

function extractTitle(doc) {
    const titleSelectors = [
        "title",
        "meta[name='title']",
        "meta[property='og:site_name']",
        "meta[property='og:title']"
    ];

    for (const selector of titleSelectors) {
        const element = doc.querySelector(selector);
        if (element) {
            let title = element.textContent.trim();
            const parts = title.split(/[-|—]/);
            if (parts.length > 1 && parts[0].length > 3) {
                return parts[0].trim();
            }
            return title;
        }
    }
    return "未知站点";
}

function extractDescription(doc) {
    console.log("开始获取描述...");

    // 先尝试获取 schema.org 数据
    const schemaScript = doc.querySelector('script[type="application/ld+json"]');
    if (schemaScript) {
        try {
            const schemaData = JSON.parse(schemaScript.textContent);
            if (schemaData.description && schemaData.description.trim()) {
                console.log("✅ 使用 schema.org 描述:", schemaData.description);
                return schemaData.description.trim();
            }
        } catch (e) {
            console.log("解析 schema.org 数据失败:", e);
        }
    }

    // 然后尝试 meta 标签
    const descSelectors = [
        "meta[name='description']",
        "meta[property='og:description']",
        "meta[name='twitter:description']"
    ];

    for (const selector of descSelectors) {
        const element = doc.querySelector(selector);
        if (element) {
            const desc = element.getAttribute("content");
            if (desc && desc.trim()) {  // 只要不是空字符串就可以
                console.log(`✅ 使用描述 (${selector}):`, desc);
                return desc.trim();
            }
        }
    }

    return null;
}

function extractFavicon(doc, siteBaseUrl, callback) {
    const faviconSelectors = [
        // 优先选择SVG格式（矢量图，不模糊）
        "link[rel='icon'][type='image/svg+xml']",
        // 优先选择高分辨率版本（从大到小）
        "link[rel='icon'][sizes='256x256']",
        "link[rel='icon'][sizes='128x128']",
        "link[rel='icon'][sizes='64x64']",
        "link[rel='apple-touch-icon']", // 通常是60x60px或更高，常用于苹果设备
        "link[rel='icon'][sizes='32x32']",
        "link[rel='icon'][sizes='16x16']",
        // 通用的rel='icon'或'shortcut icon'
        "link[rel='icon']",
        "link[rel='shortcut icon']"
    ];

    for (const selector of faviconSelectors) {
        const element = doc.querySelector(selector);
        if (element) {
            let url = element.getAttribute("href");
            if (url && !url.includes("localhost")) {
                const fullUrl = url.startsWith("http") ? url : new URL(url, siteBaseUrl).href;
                console.log(`✅ 找到 favicon (${selector}):`, fullUrl);
                return callback(fullUrl);
            }
        }
    }

    // 检查 `/favicon.ico`
    const fallbackFavicon = `${siteBaseUrl}/favicon.ico`;
    fetch(fallbackFavicon, { method: "HEAD" })
        .then(response => {
            if (response.ok) {
                console.log(`✅ 使用默认 favicon: ${fallbackFavicon}`);
                callback(fallbackFavicon);
            } else {
                callback(null);
            }
        })
        .catch(() => callback(null));
}

function extractAvatar(doc, siteBaseUrl) {
    const avatarSelectors = [
        { selector: "#logo", attr: "style" },
        { selector: ".site-avatar img", attr: "src" },
        { selector: "img.site-logo", attr: "src" },
        { selector: "img.logo-image", attr: "src" },
        { selector: ".logo", attr: "src" },
        { selector: "img.logo", attr: "src" },
        { selector: ".max-h-\\[5rem\\]", attr: "src" },
        { selector: "img[class*='logo']", attr: "src" },
        { selector: "meta[property='og:image']", attr: "content" }
    ];

    for (const { selector, attr } of avatarSelectors) {
        const element = doc.querySelector(selector);
        if (!element) continue;

        let url;
        if (attr === "style") {
            const style = element.getAttribute("style");
            const match = style?.match(/url\(['"]?([^'"]+)['"]?\)/);
            url = match ? match[1] : null;
        } else {
            url = element.getAttribute(attr);
        }

        if (url && !url.includes("localhost")) {
            const fullUrl = url.startsWith("http") ? url : new URL(url, siteBaseUrl).href;
            console.log(`✅ 找到头像 (${selector}):`, fullUrl);
            return fullUrl;
        }
    }

    return null;
}

function updateCardContent(card, data) {
    const nameEl = card.querySelector(".friend-name");
    const descEl = card.querySelector(".friend-desc");
    const faviconEl = card.querySelector(".friend-favicon");
    const avatarEl = card.querySelector(".friend-avatar");

    nameEl.textContent = data.title || card.getAttribute("data-fallback-title") || "未知站点";

    if (data.description) {
        descEl.textContent = data.description;
        descEl.style.display = "block";
    } else {
        descEl.style.display = "none";
    }

    if (data.favicon) {
        faviconEl.src = data.favicon;
        faviconEl.style.display = "block";
        faviconEl.onerror = () => {
            faviconEl.style.display = "none";
        };
    }

    if (data.avatar) {
        avatarEl.src = data.avatar;
        avatarEl.style.display = "block";
        avatarEl.onerror = () => {
            avatarEl.style.display = "none";
        };
    } else {
        avatarEl.style.display = "none";
    }
}
