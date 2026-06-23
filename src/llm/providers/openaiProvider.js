// 警告：在浏览器端直接调用API仅适用于本地测试，因为API密钥无法在纯前端应用中得到完全保护。
// 对于实际部署，请将API调用移至后端代理。

export class OpenAIProvider {
    constructor(apiKey, model = 'gpt-3.5-turbo') {
        if (!apiKey) {
            throw new Error('API Key是必须的。');
        }
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = 'https://api.deepseek.com';
    }

    async generate(prompt) {
        const url = `${this.baseUrl}/chat/completions`;

        const messages = [{ role: 'user', content: prompt }];

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.model,
                messages: messages,
                temperature: 0.7,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API调用失败: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        if (!data.choices || data.choices.length === 0) {
            return 'API返回了空的choices数组，请检查您的请求或模型。';
        }
        return data.choices[0]?.message?.content ?? '';
    }
}
