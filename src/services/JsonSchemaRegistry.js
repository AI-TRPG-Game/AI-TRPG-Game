/**
 * JSON Schema 注册表 —— 定义各 FlowType 的输出 JSON 结构。
 * 通过 response_format: { type: "json_object" } 传入 DeepSeek API。
 */
import { FlowType } from '../domain/enums.js';

const SCHEMAS = {
  [FlowType.WORLD_GEN]: {
    type: 'object',
    description: '世界观描述',
    properties: {
      world_description: {
        type: 'string',
        description: '世界观描述文本，300字以内',
      },
    },
    required: ['world_description'],
  },

  [FlowType.CHARACTER_GEN]: {
    type: 'object',
    description: '人物档案',
    properties: {
      character_card: {
        type: 'object',
        description: '人物档案',
        properties: {
          name: { type: 'string' },
          age: { type: 'integer' },
          gender: { type: 'string' },
          occupation: { type: 'string' },
          personality: { type: 'string' },
          portrait: { type: 'string' },
          attributes: {
            type: 'object',
            properties: {
              strength: { type: 'integer' },
              dexterity: { type: 'integer' },
              constitution: { type: 'integer' },
              size: { type: 'integer' },
              appearance: { type: 'integer' },
              intelligence: { type: 'integer' },
              willpower: { type: 'integer' },
              education: { type: 'integer' },
            },
            required: ['strength', 'dexterity', 'constitution', 'size', 'appearance', 'intelligence', 'willpower', 'education'],
          },
          hp: { type: 'integer' },
          san: { type: 'integer' },
          credit_rating: { type: 'integer' },
          occupational_skills: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                value: { type: 'integer' },
              },
              required: ['name', 'value'],
            },
          },
          personal_skills: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                value: { type: 'integer' },
              },
              required: ['name', 'value'],
            },
          },
          inventory: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['name', 'age', 'gender', 'occupation', 'personality', 'portrait', 'attributes', 'hp', 'san', 'credit_rating', 'occupational_skills', 'personal_skills'],
      },
    },
    required: ['character_card'],
  },

  [FlowType.STORY_OPENING]: {
    type: 'object',
    description: '故事开幕输出',
    properties: {
      narration: { type: 'string', description: '开幕叙述文本' },
      locations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['name', 'description'],
        },
      },
      npcs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['name', 'description'],
        },
      },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            status: { type: 'string', description: '已获得 或 已失去' },
            description: { type: 'string' },
          },
          required: ['name', 'status', 'description'],
        },
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: '恰好4个选项，以A./B./C./D.开头，最后固定为D. 自由行动',
      },
    },
    required: ['narration', 'options'],
  },

  [FlowType.NARRATION_I]: {
    type: 'object',
    description: '叙述I输出 —— 可能包含dice判定',
    properties: {
      narration: { type: 'string', description: '叙述文本' },
      dice: {
        type: 'object',
        description: '投掷判定信息（需要判定时出现，不需要时省略）',
        properties: {
          skill_name: { type: 'string' },
          skill_point: { type: 'integer', description: '技能点数' },
          notation: { type: 'string', description: '骰子表达式，如 1d100' },
          success_rate: { type: 'integer', description: '成功率（百分数），如 50 表示50%' },
        },
        required: ['skill_name', 'skill_point', 'notation', 'success_rate'],
      },
      locations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['name', 'description'],
        },
      },
      npcs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['name', 'description'],
        },
      },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            status: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['name', 'status', 'description'],
        },
      },
      hp: { type: ['integer', 'null'], description: 'HP变化值，无变化为null' },
      san: { type: ['integer', 'null'], description: 'SAN变化值，无变化为null' },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: '4个选项，最后一个固定为D. 自由行动',
      },
    },
    required: ['narration'],
  },

  [FlowType.NARRATION_II]: {
    type: 'object',
    description: '叙述II输出 —— 投掷结果后的叙事',
    properties: {
      narration: { type: 'string', description: '叙述文本' },
      dice: {
        type: 'object',
        description: '新一轮投掷判定（如有）',
        properties: {
          skill_name: { type: 'string' },
          skill_point: { type: 'integer', description: '技能点数' },
          notation: { type: 'string' },
          success_rate: { type: 'integer', description: '成功率（百分数）' },
        },
        required: ['skill_name', 'skill_point', 'notation', 'success_rate'],
      },
      locations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['name', 'description'],
        },
      },
      npcs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['name', 'description'],
        },
      },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            status: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['name', 'status', 'description'],
        },
      },
      hp: { type: ['integer', 'null'] },
      san: { type: ['integer', 'null'] },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: '4个选项',
      },
    },
    required: ['narration'],
  },

  [FlowType.HISTORY_SUMMARY]: {
    type: 'object',
    description: '历史总结',
    properties: {
      summary: {
        type: 'string',
        description: '总结文本，300字以内',
      },
    },
    required: ['summary'],
  },
};

export class JsonSchemaRegistry {
  /**
   * 获取用于 response_format 的 JSON Schema 字符串。
   * DeepSeek 目前仅支持 response_format: { type: "json_object" }，
   * 因此 schema 详情通过 system prompt 中的示例传递给 LLM。
   */
  static getSchema(flowType) {
    return SCHEMAS[flowType] || null;
  }

  /**
   * 生成 human-readable 的 JSON 格式示例文本，用于 system prompt。
   */
  static getSchemaExample(flowType) {
    const schema = SCHEMAS[flowType];
    if (!schema) return '';

    return JSON.stringify(schema, null, 2);
  }
}
