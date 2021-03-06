import frappe from 'frappejs';
import fs from 'fs';
import { _ } from 'frappejs/utils';
import { remote, shell } from 'electron';
import router from '@/router';
import Avatar from '@/components/Avatar';

export function createNewDatabase() {
  return new Promise(resolve => {
    remote.dialog.showSaveDialog(
      remote.getCurrentWindow(),
      {
        title: _('Select folder'),
        defaultPath: 'frappe-accounting.db'
      },
      filePath => {
        if (filePath) {
          if (!filePath.endsWith('.db')) {
            filePath = filePath + '.db';
          }
          if (fs.existsSync(filePath)) {
            showMessageDialog({
              // prettier-ignore
              message: _('A file exists with the same name and it will be overwritten. Are you sure you want to continue?'),
              buttons: [
                {
                  label: _('Overwrite'),
                  action() {
                    fs.unlinkSync(filePath);
                    resolve(filePath);
                  }
                },
                { label: _('Cancel'), action() {} }
              ]
            });
          } else {
            resolve(filePath);
          }
        }
      }
    );
  });
}

export function loadExistingDatabase() {
  return new Promise(resolve => {
    remote.dialog.showOpenDialog(
      remote.getCurrentWindow(),
      {
        title: _('Select file'),
        properties: ['openFile'],
        filters: [{ name: 'SQLite DB File', extensions: ['db'] }]
      },
      files => {
        if (files && files[0]) {
          resolve(files[0]);
        }
      }
    );
  });
}

export function showMessageDialog({ message, description, buttons = [] }) {
  let buttonLabels = buttons.map(a => a.label);
  remote.dialog.showMessageBox(
    remote.getCurrentWindow(),
    {
      message,
      detail: description,
      buttons: buttonLabels
    },
    response => {
      let button = buttons[response];
      if (button && button.action) {
        button.action();
      }
    }
  );
}

export function deleteDocWithPrompt(doc) {
  return new Promise(resolve => {
    showMessageDialog({
      message: _('Are you sure you want to delete {0} "{1}"?', [
        doc.doctype,
        doc.name
      ]),
      description: _('This action is permanent'),
      buttons: [
        {
          label: _('Delete'),
          action: () => {
            doc
              .delete()
              .then(() => resolve(true))
              .catch(e => {
                handleErrorWithDialog(e, doc);
              });
          }
        },
        {
          label: _('Cancel'),
          action() {
            resolve(false);
          }
        }
      ]
    });
  });
}

export function partyWithAvatar(party) {
  return {
    data() {
      return {
        imageURL: null,
        label: null
      };
    },
    components: {
      Avatar
    },
    async mounted() {
      this.imageURL = await frappe.db.getValue('Party', party, 'image');
      this.label = party;
    },
    template: `
      <div class="flex items-center" v-if="label">
        <Avatar class="flex-shrink-0" :imageURL="imageURL" :label="label" size="sm" />
        <span class="ml-2 truncate">{{ label }}</span>
      </div>
    `
  };
}

export function openQuickEdit({ doctype, name, hideFields, defaults = {} }) {
  let currentRoute = router.currentRoute;
  let query = currentRoute.query;
  let method = 'push';
  if (query.edit && query.doctype === doctype) {
    // replace the current route if we are
    // editing another document of the same doctype
    method = 'replace';
  }
  router[method]({
    query: {
      edit: 1,
      doctype,
      name,
      hideFields,
      values: defaults,
      lastRoute: currentRoute
    }
  });
}

export function handleErrorWithDialog(e, doc) {
  let errorMessage = e.message || _('An error occurred');
  if (e.type === frappe.errors.LinkValidationError) {
    errorMessage = _('{0} {1} is linked with existing records.', [
      doc.doctype,
      doc.name
    ]);
  } else if (e.type === frappe.errors.DuplicateEntryError) {
    errorMessage = _('{0} {1} already exists.', [doc.doctype, doc.name]);
  }

  showMessageDialog({
    message: errorMessage
  });

  throw e;
}

export function makePDF(html, destination) {
  const { BrowserWindow } = remote;

  let printWindow = new BrowserWindow({
    width: 595,
    height: 842,
    show: false,
    webPreferences: {
      nodeIntegration: true
    }
  });

  let webpackDevServerURL = remote.getGlobal('WEBPACK_DEV_SERVER_URL');
  if (webpackDevServerURL) {
    // Load the url of the dev server if in development mode
    printWindow.loadURL(webpackDevServerURL + 'print');
  } else {
    // Load the index.html when not in development
    printWindow.loadURL(`app://./print.html`);
  }

  printWindow.on('closed', () => {
    printWindow = null;
  });

  const code = `
    document.body.innerHTML = \`${html}\`;
  `;

  printWindow.webContents.executeJavaScript(code);

  return new Promise(resolve => {
    printWindow.webContents.on('did-finish-load', () => {
      printWindow.webContents.printToPDF(
        {
          marginsType: 1, // no margin
          pageSize: 'A4',
          printBackground: true
        },
        (error, data) => {
          if (error) throw error;
          printWindow.close();
          fs.writeFile(destination, data, error => {
            if (error) throw error;
            resolve(shell.openItem(destination));
          });
        }
      );
    });
  });
}

export function getActionsForDocument(doc) {
  if (!doc) return [];

  let deleteAction = {
    component: {
      template: `<span class="text-red-700">{{ _('Delete') }}</span>`
    },
    condition: doc => !doc.isNew() && !doc.submitted,
    action: () =>
      deleteDocWithPrompt(doc).then(res => {
        if (res) {
          router.push(`/list/${doc.doctype}`);
        }
      })
  };

  let actions = [...(doc.meta.actions || []), deleteAction]
    .filter(d => (d.condition ? d.condition(doc) : true))
    .map(d => {
      return {
        label: d.label,
        component: d.component,
        action: d.action.bind(this, doc, router)
      };
    });

  return actions;
}
