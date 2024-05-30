/**
* Copyright (c) 2023 - present TinyEngine Authors.
* Copyright (c) 2023 - present Huawei Cloud Computing Technologies Co., Ltd.
*
* Use of this source code is governed by an MIT-style license.
*
* THE OPEN SOURCE SOFTWARE IN THIS PRODUCT IS DISTRIBUTED IN THE HOPE THAT IT WILL BE USEFUL,
* BUT WITHOUT ANY WARRANTY, WITHOUT EVEN THE IMPLIED WARRANTY OF MERCHANTABILITY OR FITNESS FOR
* A PARTICULAR PURPOSE. SEE THE APPLICABLE LICENSES FOR MORE DETAILS.
*
*/
const _ = require('lodash');
const { sanitizeEntity } = require('strapi-utils');
const { ERROR_TYPE, UNIT_TYPE, AUTH_TYPE } = require('../../../config/constants');
const { throwErrors, getPublicSuperAdmin, isTenantAdmin } = require('../../../config/toolkits');

/**
 * 选择对象中的属性返回新对象
 * @param {Object} obj 被选择对象
 * @param {Array} fields 需要选择的属性数组
 * @param {Boolean} isInclude 是否为包含模式
 */
function pickObject(obj, fileds, isInclude = true) {
  const toString = Object.prototype.toString.call(obj);
  const objType = toString.slice(8, toString.length - 1);
  if (objType !== 'Object') {
    throw new Error('first param must be an Object');
  }
  const result = {};
  const fieldsSet = new Set(fileds);
  Object.keys(obj).forEach(key => {
    const shouldCopyValue = isInclude ? fieldsSet.has(key) : !fieldsSet.has(key);
    if (shouldCopyValue) {
      result[key] = obj[key];
    }
  });
  return result;
}

module.exports = {
  // 我的相关数据查询
  async findOne(ctx) {
    const data = await strapi.services.apps.findOne({ id: ctx.params.id });
    const app = sanitizeEntity(
      {
        ...data,
        platform: filterPlatformField(data.platform),
      },
      {
        model: strapi.models.apps,
      }
    );
    if (app) {
      app.associate_apps = [];
    }
    return app;
  },

  async find(ctx) {
    const filter = await getAppsFilter(ctx);
    const list = await strapi.services.apps.find(filter);
    return list.map((item) =>
      sanitizeEntity(
        {
          ...item,
          platform: filterPlatformField(item.platform),
        },
        {
          model: strapi.models.apps,
        }
      )
    );
  },

  async count(ctx) {
    const filter = await getAppsFilter(ctx);
    return strapi.services.apps.count(filter);
  },

  async deleteByPlatformId(ctx) {
    const { pid } = ctx.params;
    const entity = await strapi.services.apps.delete({ platform: pid });
    return sanitizeEntity(entity, { model: strapi.models.apps });
  },

  async list(ctx) {
    const { pid } = ctx.params;
    const list = await strapi.services.apps.find({ platform: pid });
    return list;
  },

  /**
   * 通过一个应用id 拉取app schema 全部相关数据,数据包括
   * 通过part 参数获取部分数据
   * 1. 应用基本信息，通过id获取
   * 2. 通过应用id，获取当前应用国际化词条
   * 3. 通过应用信息，查询区块分组和物料资产包关联的区块构建产物数据，版本浮动会引起性能问题；
   * 4. 通过应用id 查询当前应用下的全部页面及文件夹
   * 5. 通过应用id 查询当前应用挂载的桥接源和工具类
   * 6. 通过应用id 查询当前应用挂载的数据源
   * 7. 通过物料资产包 查询当前物料资产包关联的组件信息
   */
  schema(ctx) {
    const { id } = ctx.params;
    const { part } = ctx.query;
    // 获取应用基本信息
    const partParam = typeof part === 'string' ? [part] : part;
    return strapi.services['get-app-schema'].getAppSchemaMeta(id, partParam);
  },

  async create(ctx) {
    const { body } = ctx.request;
    if (!body) {
      throwErrors('Missing  "body" parameter', ERROR_TYPE.notFound);
    }
    const { user = {} } = ctx.state;
    let createParam = {
      ...body,
      createdBy: user.id,
    }

    if (body.action === 'creatAppFromTpl') {
      delete createParam.action;
      try {
        const res = await strapi.services.apps.create(createParam);
        try {
          const template = await strapi.services.apps.findOne({ template_type: 'serviceDevelop' });
          // console.log('template', template);
          // todo: 从模板创建应用

          const blockGroups = await strapi.services['block-groups'].find({ app: template.id });
          // console.log('blockGroups', blockGroups);
          blockGroups.forEach(async (blockGroup) => {
            const createParam = pickObject(blockGroup, ['app', 'name', 'desc']);
            await strapi.services['block-groups'].create({
              ...createParam,
              app: res.id,
            });
          })

          const pages = await strapi.services['pages'].find({ app: template.id });
          // console.log('pages', pages);
          pages.forEach(async (page) => {
            const { is_page } = page;
            if (is_page) {
              // 创建页面
              const createPageParam = pickObject(
                page,
                [
                  'app',
                  'group',
                  'isBody',
                  'isHome',
                  'isPage',
                  'message',
                  'name',
                  'parentId',
                  'route',
                  'page_content'
                ]
              );
              await strapi.services['pages'].create({
                ...createPageParam,
                app: res.id,
              });
            } else {
              // 创建文件夹
              const createFolderParam = pickObject(
                page,
                [
                  'app',
                  'name',
                  'parentId',
                  'route',
                  'isPage'
                ]
              );
              await strapi.services['pages'].create({
                ...createFolderParam,
                app: res.id,
              });
            }
          })

          const blockCategories = await strapi.services['block-category'].find({ app: template.id });
          // console.log('blockCategories', blockCategories);
          blockCategories.forEach(async (blockCategory) => {
            await strapi.services['block-category'].create({
              ...blockCategory,
              app: res.id,
            });
          })

          const blocks = await strapi.services['block'].listNew({ appId: template.id, createdBy: user.id });
          // console.log('blocks', blocks);
          blocks.forEach(async (block) => {
            const createParam = pickObject(block, [
              'label',
              'name_cn',
              'framework',
              'content',
              'description',
              'path',
              'screenshot',
              'created_app',
              'tags',
              'public',
              'public_scope_tenants',
              'categories',
              'occupier',
              'isDefault',
              'isOfficial'
            ]);
            // public 不是部分公开, 则public_scope_tenants为空数组
            if (createParam.public !== E_Public.SemiPublic) {
              createParam.public_scope_tenants = [];
            }
            // 对传入的tags 进行过滤
            if (createParam.tags) {
              createParam.tags = createParam.tags.filter((tag) => !!tag);
            }
            // 处理区块截图
            // if (createParam.screenshot) {
            //  const url = await this.service.materialCenter.block.handleScreenshot(createParam);
            //  createParam.screenshot = url;
            //  }
            await strapi.services['block'].create({
              ...createParam,
              created_app: res.id,
            });
          })

          const sources = await strapi.services['sources'].find({ app: template.id });
          // console.log('sources', sources);
          sources.forEach(async (source) => {
            await strapi.services['sources'].create({
              ...source,
              app: res.id,
            });
          })

          const extensions = await strapi.services['app-extensions'].find({ app: template.id });
          // console.log('extensions', extensions);
          extensions.forEach(async (extension) => {
            await strapi.services['app-extensions'].create({
              ...extension,
              app: res.id,
            });
          })

          const workflows = await strapi.services['workflows'].find({ app: template.id });
          // console.log('workflows', workflows);
          workflows.forEach(async (workflow) => {
            await strapi.services['workflows'].create({
              ...workflow,
              app: res.id,
              comfyui_url: body.config?.comfyui_url
            });
          })
        } catch (error) {
          console.error('create app from template error', error);
        }

        return res;
      } catch (error) {
        console.error('create app error', error);
      }
    } else {
      delete createParam.action;
      return strapi.services.apps.create(createParam);
    }
  },

  async delete(ctx) {
    const { id } = ctx.params;
    const { user = {} } = ctx.state;
    try {
      const blockGroups = await strapi.services['block-groups'].find({ app: id });
      // console.log('blockGroups', blockGroups);
      blockGroups.forEach(async (blockGroup) => {
        await strapi.services['block-groups'].delete({
          id: blockGroup.id,
        });
      })

      const pages = await strapi.services['pages'].find({ app: id });
      // console.log('pages', pages);
      pages.forEach(async (page) => {
        await strapi.services['pages'].delete({
          id: page.id,
        });
      })

      const blockCategories = await strapi.services['block-category'].find({ app: id });
      // console.log('blockCategories', blockCategories);
      blockCategories.forEach(async (blockCategory) => {
        await strapi.services['block-category'].delete({
          id: blockCategory.id
        });
      })

      const blocks = await strapi.services['block'].listNew({ appId: id, createdBy: user.id });
      // console.log('blocks', blocks);
      blocks.forEach(async (block) => {
        await strapi.services['block'].delete({
          id: block.id,
        });
      })

      const sources = await strapi.services['sources'].find({ app: id });
      // console.log('sources', sources);
      sources.forEach(async (source) => {
        await strapi.services['sources'].delete({
          id: source.id,
        });
      })

      const extensions = await strapi.services['app-extensions'].find({ app: id });
      // console.log('extensions', extensions);
      extensions.forEach(async (extension) => {
        await strapi.services['app-extensions'].delete({
          id: extension.id,
        });
      })

      const workflows = await strapi.services['workflows'].find({ app: id });
      // console.log('workflows', workflows);
      workflows.forEach(async (workflow) => {
        await strapi.services['workflows'].delete({
          id: workflow.id,
        });
      })
    } catch (error) {
      console.error('delete app error', error);
    }
    return strapi.services['apps'].delete({ id });
  },

  async update(ctx) {
    const { body } = ctx.request;
    const { user = {} } = ctx.state;
    const { id } = ctx.params;
    if (!body) {
      throwErrors('Missing  "body" parameter', ERROR_TYPE.notFound);
    }
    // 只有超级管理员可以设置应用相关的特殊属性
    if (!user.is_admin) {
      delete body.is_default;
      delete body.is_demo;
      delete body.template_type;
    }
    if (body.template_type) {
      body.set_template_by = user.id;
    }
    // 应用 是否为默认状态的 开闭 需要将操作此应用的超级管理员用户id记录下来
    if (body.is_default !== undefined && user.is_admin) {
      body.set_default_by = user.id;
    }

    // 当设置is_demo应用为false时，删除数据库中的此应用默认权限
    // 当前默认权限场景单一，只有demo应用的游客权限，所以无需传入角色id进行进一步的条件锁定，后续可能随着角色的膨胀，更改此条件
    if (body.is_demo === false) {
      strapi.services['auth-users-units-role'].delete({
        unit_type: UNIT_TYPE.apps,
        unit_id: id,
        auth_type: AUTH_TYPE.acquiescence,
      });
    }
    try {
      const workflows = await strapi.services['workflows'].find({ app: id });
      workflows.forEach(async (workflow) => {
        await strapi.services['workflows'].update({
          id: workflow.id,
        }, {
          comfyui_url: body.config?.comfyui_url,
        });
      })
    } finally {
      return strapi.services.apps.update({ id }, body);
    }
  },


  // 修改应用关联国际化语种
  async updateI18n(ctx) {
    const res = await this.update(ctx);
    return sanitizeEntity(
      {
        ...res,
      },
      {
        model: strapi.models.apps,
        includeFields: ['id', 'i18n_langs'],
      }
    );
  },

  async associateBlocksInApps(ctx) {
    // 获取关联的应用列表
    const applist = await strapi.services.apps.find(ctx.query);
    if (!applist?.length) {
      return [];
    }
    const apps = sanitizeEntity(applist, {
      model: strapi.models.apps,
      includeFields: ['id', 'name', 'block_groups'],
    });

    // 汇总相关的区块分组的id
    const blockGroupIds = apps.reduce((pre, cur) => {
      const ids = cur.block_groups.map((group) => group.id);
      return [...pre, ...ids];
    }, []);

    // 获取关联的区块id和版本
    const blocksVersionlist = await strapi.services['blocks-carriers-relation'].find({
      host_in: blockGroupIds,
      host_type: 'blockGroup',
    });
    const blocksVersions = sanitizeEntity(blocksVersionlist, {
      model: strapi.models['blocks-carriers-relation'],
      includeFields: ['block', 'version', 'host'],
    });

    // 获取区块列表
    const blockIdSet = new Set();
    blocksVersions.forEach((blockVersion) => {
      blockIdSet.add(blockVersion.block);
    });
    const includeFields = ['id', 'label', 'npm_name', 'public_scope_tenants', 'histories_length'];
    const blocks = await strapi.services.block.findBlocks(
      ctx.state.user,
      { id_in: Array.from(blockIdSet) },
      includeFields
    );

    apps.forEach((app) => {
      app.block_groups?.forEach((blockGroup) => {
        const blocksIds = blocksVersionlist
          .filter((blockVersions) => blockVersions.host === blockGroup.id)
          .map((blockVersions) => blockVersions.block);
        const blocksInGroup = blocks.filter((block) => blocksIds.includes(block.id));
        blockGroup.blocks = blocksInGroup;
      });
    });
    return apps;
  },

  async syncDataHandler() {
    const apps = await strapi.services.apps.find({ data_handler_null: false });
    for (const { id, data_handler: dataHandler } of apps) {
      const updateInfo = {
        data_source_global: {
          dataHandler,
        },
      };
      await strapi.services.apps.update({ id }, updateInfo);
    }
    return apps.length;
  },
};

const getAppsFilter = async (ctx) => {
  const { query } = ctx.request;
  const { user } = ctx.state;
  // if (query.filter_type === 'mine') {
  //   delete query.filter_type;
  //   const filter = {
  //     // tenant: user.tenant.id,
  //     tenant: 1,
  //   };
  //   if (!isTenantAdmin(user)) {
  //     const appsId = await getManagedAppsId(user);
  //     const publicAdmins = await getPublicSuperAdmin();
  //     const publicAdminsId = publicAdmins.map((item) => item.id);
  //     filter._or = [{ createdBy: user.id }, { id_in: appsId }, { set_default_by_in: publicAdminsId }];
  //   }
  //   return _.merge(query, filter);
  // }

  if (query.filter_type === 'mine') {
    delete query.filter_type;
    const filter = {
      createdBy: user.id,
    };
    return _.merge(query, filter);
  }

  return query;
};

// 获取用户参与管理的应用id集合
const getManagedAppsId = async ({ auths = [] }) => {
  const appsId = [];
  auths.forEach(({ unit = {} }) => {
    if (unit.type === UNIT_TYPE.apps) {
      appsId.push(unit.id);
    }
  });
  return appsId;
};

// 获取应用关联的应用集合
const getAssociateAppsId = async (id) => {
  const relation = await strapi.query('app-relations').find({
    _or: [{ app_left: id }, { app_right: id }],
  });
  return relation.map(({ app_left, app_right }) => (app_left === id ? app_right : app_left));
};

const filterPlatformField = (item) => item && { id: item.id, name: item.name };
